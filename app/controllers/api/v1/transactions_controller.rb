require "digest"

module Api
  module V1
    class TransactionsController < ApplicationController
      def index
        transactions = current_user.transactions
        transactions = transactions.where(occurred_at: parse_time(params[:from])..parse_time(params[:to], end_of_day: true)) if params[:from].present? && params[:to].present?
        transactions = transactions.where(kind: params[:kind]) if params[:kind].present?
        %w[category_id account_id merchant_id].each { |field| transactions = transactions.where(field => params[field]) if params[field].present? }
        transactions = transactions.where("note LIKE :q OR payment_method LIKE :q", q: "%#{ActiveRecord::Base.sanitize_sql_like(params[:q].to_s)}%") if params[:q].present?
        transactions = transactions.where("amount_cents >= ?", params[:min_amount]) if params[:min_amount].present?
        transactions = transactions.where("amount_cents <= ?", params[:max_amount]) if params[:max_amount].present?
        sort = params[:sort].to_s
        column = %w[occurred_at amount_cents created_at].include?(sort.delete_prefix("-")) ? sort.delete_prefix("-") : "occurred_at"
        transactions = transactions.order(column => sort.start_with?("-") ? :desc : :asc)
        page = [ params.fetch(:page, 1).to_i, 1 ].max
        per_page = [ params.fetch(:per_page, 25).to_i, 1 ].max.clamp(1, 100)
        total = transactions.count
        rows = transactions.offset((page - 1) * per_page).limit(per_page)
        render json: { data: rows.map { |transaction| transaction_payload(transaction) }, meta: { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil } }
      rescue ArgumentError
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      def create
        with_idempotency do
          transaction = current_user.transactions.new(transaction_params)
          if transaction.save
            transaction.merchant&.increment!(:usage_count)
            render json: { data: transaction_payload(transaction) }, status: :created
          else
            render_validation_error(transaction)
          end
        end
      end

      def show
        render json: { data: transaction_payload(current_user.transactions.find(params[:id])) }
      end

      def update
        transaction = current_user.transactions.find(params[:id])
        if transaction.update(transaction_params)
          render json: { data: transaction_payload(transaction) }
        else
          render_validation_error(transaction)
        end
      end

      def destroy
        current_user.transactions.find(params[:id]).destroy!
        head :no_content
      end

      def duplicate
        original = current_user.transactions.find(params[:id])
        copy = original.dup
        copy.occurred_at = Time.zone.now
        copy.save!
        render json: { data: transaction_payload(copy) }, status: :created
      end

      private

      def transaction_params
        params.permit(:account_id, :category_id, :merchant_id, :kind, :amount_cents, :currency, :occurred_at, :note, :payment_method, :source, :transfer_account_id, image_urls: [])
      end

      def transaction_payload(transaction)
        transaction.as_json(only: %i[id user_id account_id category_id merchant_id kind amount_cents currency occurred_at note payment_method image_urls source transfer_account_id created_at updated_at])
      end

      def parse_time(value, end_of_day: false)
        time = Time.zone.parse(value.to_s)
        end_of_day ? time.end_of_day : time.beginning_of_day
      end

      def with_idempotency
        key = request.headers["Idempotency-Key"].presence
        return yield unless key
        hash = Digest::SHA256.hexdigest([ request.request_method, request.path, request.raw_post ].join("\0"))
        existing = current_user.idempotency_keys.find_by(key: key)
        if existing && existing.created_at > 24.hours.ago
          if existing.request_hash != hash
            return render_error(code: "idempotency_conflict", message: I18n.t("api.errors.idempotency_conflict"), status: :unprocessable_content)
          end
          return render json: JSON.parse(existing.response_body), status: existing.response_status
        end
        yield
        current_user.idempotency_keys.create!(key: key, request_hash: hash, response_status: response.status, response_body: response.body)
      rescue ActiveRecord::RecordNotUnique
        retry
      end
    end
  end
end
