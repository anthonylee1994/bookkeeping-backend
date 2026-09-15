require "digest"
require "open-uri"
require "base64"
require "stringio"

module Api
  module V1
    class AiController < ApplicationController
      def parse
        url = params.require(:image_url).to_s
        uri = URI.parse(url)
        allowed = ENV.fetch("LIHKG_ALLOWED_HOSTS", "img.eservice-hk.net").split(",").map(&:strip)
        return render_error(code: "validation_error", message: "image host is not allowed", status: :bad_request) unless uri.is_a?(URI::HTTP) && allowed.include?(uri.host)

        image = URI.open(uri.to_s, open_timeout: 10, read_timeout: 10)
        bytes = image.read
        sha = Digest::SHA256.hexdigest(bytes)
        categories = user_categories
        signature = parse_signature(categories)
        cached = current_user.ai_import_logs.where(image_sha256: sha, parse_signature: signature, status: :success).where("created_at > ?", Integer(ENV.fetch("AI_CACHE_HOURS", 24)).hours.ago).order(created_at: :desc).first
        return render json: { data: cached_payload(cached, categories:) } if cached

        result = DeepSeekService.call(image_base64: Base64.strict_encode64(bytes), content_type: image.content_type || Marcel::MimeType.for(StringIO.new(bytes)), categories:)
        parsed = normalize_category_hint(result[:parsed], categories)
        log = current_user.ai_import_logs.create!(image_urls: [ url ], image_sha256: sha, parse_signature: signature, status: result[:status], raw_response: result[:raw_response], parsed_json: parsed, error_message: result[:error_message], tokens_in: result[:tokens_in], tokens_out: result[:tokens_out], latency_ms: result[:latency_ms])
        payload = cached_payload(log, categories:)
        return render json: { data: payload }, status: :bad_gateway if log.failed?
        render json: { data: payload }
      rescue URI::InvalidURIError
        render_error(code: "validation_error", message: "image host is not allowed", status: :bad_request)
      rescue OpenURI::HTTPError, SocketError, Timeout::Error => e
        render_error(code: "upstream_error", message: e.message, status: :bad_gateway)
      rescue DeepSeekService::Error, Faraday::Error => e
        render_error(code: "upstream_error", message: e.message, status: :bad_gateway)
      end

      def confirm
        with_idempotency do
          log_id = params[:ai_import_log_id].presence || params.require(:import_log_id)
          log = current_user.ai_import_logs.find(log_id)
          attrs = params.permit(:account_id, :category_id, :merchant_id, :kind, :amount_cents, :currency, :occurred_at, :note, image_urls: [])
          transaction = current_user.transactions.create!(attrs.merge(source: :ai, image_urls: attrs[:image_urls].presence || log.image_urls))
          log.update!(transaction_record: transaction)
          render json: { data: transaction_payload(transaction) }, status: :created
        end
      rescue ActiveRecord::RecordInvalid => e
        render_validation_error(e.record)
      end

      private

      def cached_payload(log, categories:)
        parsed = normalize_category_hint(log.parsed_json, categories) || {}
        { id: log.id, image_urls: log.image_urls, sha256: log.image_sha256, status: log.status, parsed: parsed, suggested_category_id: suggested_category_id(parsed, categories), raw_response: log.raw_response, error: log.error_message, tokens_in: log.tokens_in, tokens_out: log.tokens_out, latency_ms: log.latency_ms }
      end

      def user_categories
        current_user.categories.order(:kind, :created_at)
      end

      # Cache 只可以重用「同版本 prompt + 同一組分類」嘅結果；改名／加減分類或者改咗
      # prompt 都會令 signature 改變，逼住重新 call AI。
      def parse_signature(categories)
        category_key = categories.map { |category| "#{category.kind}:#{category.name}" }.sort.join("\u0000")
        Digest::SHA256.hexdigest("#{DeepSeekService::PROMPT_VERSION}\u0000#{category_key}")
      end

      # category_hint 一定要對得上當前 user 嘅分類（同名同 kind），對唔上就一律當 null，
      # 唔會將 AI 作嘅分類名漏出去。suggested_category_id 亦由此而來。
      def normalize_category_hint(parsed, categories)
        return parsed if parsed.blank?

        normalized = parsed.dup
        normalized["category_hint"] = match_category(normalized, categories)&.name
        normalized
      end

      def suggested_category_id(parsed, categories)
        match_category(parsed, categories)&.id
      end

      def match_category(parsed, categories)
        hint = (parsed["category_hint"] || parsed[:category_hint]).to_s.strip
        kind = parsed["kind"] || parsed[:kind]
        return nil if hint.empty?

        categories.find { |category| category.kind == kind && category.name.casecmp?(hint) }
      end

      def transaction_payload(transaction)
        transaction.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note image_urls source]).merge("net_amount_cents" => transaction.amount_cents)
      end

      def with_idempotency
        key = request.headers["Idempotency-Key"].presence
        return yield unless key
        hash = Digest::SHA256.hexdigest([ request.request_method, request.path, request.raw_post ].join("\0"))
        existing = current_user.idempotency_keys.find_by(key: key)
        if existing && existing.created_at > 24.hours.ago
          return render_error(code: "idempotency_conflict", message: I18n.t("api.errors.idempotency_conflict"), status: :unprocessable_content) if existing.request_hash != hash
          return render json: JSON.parse(existing.response_body), status: existing.response_status
        end
        yield
        current_user.idempotency_keys.create!(key: key, request_hash: hash, response_status: response.status, response_body: response.body)
      end
    end
  end
end
