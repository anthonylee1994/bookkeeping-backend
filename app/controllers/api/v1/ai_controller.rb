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
        cached = current_user.ai_import_logs.where(image_sha256: sha, status: :success).where("created_at > ?", Integer(ENV.fetch("AI_CACHE_HOURS", 24)).hours.ago).order(created_at: :desc).first
        return render json: { data: cached_payload(cached, categories:) } if cached

        result = DeepSeekService.call(image_base64: Base64.strict_encode64(bytes), content_type: image.content_type || Marcel::MimeType.for(StringIO.new(bytes)), categories:)
        log = current_user.ai_import_logs.create!(image_urls: [ url ], image_sha256: sha, status: result[:status], raw_response: result[:raw_response], parsed_json: result[:parsed], error_message: result[:error_message], tokens_in: result[:tokens_in], tokens_out: result[:tokens_out], latency_ms: result[:latency_ms])
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
        parsed = log.parsed_json || {}
        { id: log.id, image_urls: log.image_urls, sha256: log.image_sha256, status: log.status, parsed: log.parsed_json, suggested_category_id: suggested_category_id(parsed, categories), raw_response: log.raw_response, error: log.error_message, tokens_in: log.tokens_in, tokens_out: log.tokens_out, latency_ms: log.latency_ms }
      end

      def user_categories
        current_user.categories.order(:kind, :position, :created_at)
      end

      # AI 只回 category_hint（分類名），喺 backend 用返當前 user 嘅分類 resolve 做 id，
      # 避免 AI 亂噏一個唔存在嘅 id。
      def suggested_category_id(parsed, categories)
        hint = (parsed["category_hint"] || parsed[:category_hint]).to_s.strip
        kind = parsed["kind"] || parsed[:kind]
        return nil if hint.empty?

        categories.find { |category| category.kind == kind && category.name.casecmp?(hint) }&.id
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
