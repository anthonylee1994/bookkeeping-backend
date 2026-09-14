module Api
  module V1
    class SummariesController < ApplicationController
      def daily
        summarize(:daily)
      end

      def weekly
        summarize(:weekly)
      end

      def monthly
        summarize(:monthly)
      end

      private

      def summarize(period)
        Time.use_zone("Asia/Hong_Kong") do
          date = params[:date].present? ? Date.iso8601(params[:date].to_s) : Time.zone.today
          from, to = boundaries(period, date)
          scope = current_user.transactions.where(occurred_at: from..to)
          regular = scope.where.not(kind: :transfer)
          income = regular.where(kind: :income).sum(:amount_cents)
          expense = regular.where(kind: :expense, refund_of_id: nil).sum(:amount_cents)
          refund = regular.where(kind: :expense).where.not(refund_of_id: nil).sum(:amount_cents)
          render json: { data: {
            range: { from: from.iso8601, to: to.iso8601 }, income_cents: income, expense_cents: expense,
            refund_cents: refund, net_cents: income - expense + refund,
            by_category: by_category(regular), by_account: by_account(regular),
            transfers: { count: scope.where(kind: :transfer).count, total_cents: scope.where(kind: :transfer).sum(:amount_cents) },
            transactions: paginated_transactions(regular)
          } }
        end
      rescue Date::Error
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      def boundaries(period, date)
        values = case period
        when :daily then [ date.beginning_of_day, date.end_of_day ]
        when :weekly then [ date.beginning_of_week(:monday), date.end_of_week(:monday) ]
        when :monthly then [ date.beginning_of_month, date.end_of_month ]
        end
        [ values.first.in_time_zone.beginning_of_day, values.last.in_time_zone.end_of_day ]
      end

      def by_category(scope)
        scope.where(kind: :expense).group(:category_id).select(:category_id).map do |row|
          category = current_user.categories.find_by(id: row.category_id)
          items = scope.where(kind: :expense, category_id: row.category_id)
          { category_id: row.category_id, name: category&.name, expense_cents: items.where(refund_of_id: nil).sum(:amount_cents), refund_cents: items.where.not(refund_of_id: nil).sum(:amount_cents) }
        end.sort_by { |row| -(row[:expense_cents] + row[:refund_cents]) }
      end

      def by_account(scope)
        scope.group(:account_id).select(:account_id).map do |row|
          account = current_user.accounts.find_by(id: row.account_id)
          items = scope.where(account_id: row.account_id)
          { account_id: row.account_id, name: account&.name, income_cents: items.where(kind: :income).sum(:amount_cents), expense_cents: items.where(kind: :expense, refund_of_id: nil).sum(:amount_cents), refund_cents: items.where(kind: :expense).where.not(refund_of_id: nil).sum(:amount_cents) }
        end
      end

      def paginated_transactions(scope)
        page = [ params.fetch(:page, 1).to_i, 1 ].max
        per_page = [ params.fetch(:per_page, 25).to_i, 1 ].max.clamp(1, 100)
        total = scope.count
        rows = scope.order(occurred_at: :desc).offset((page - 1) * per_page).limit(per_page)
        { data: rows.map { |tx| tx.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note payment_method image_urls source refund_of_id transfer_account_id]).merge("net_amount_cents" => tx.amount_cents - tx.refunds.sum(:amount_cents)) }, meta: { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil } }
      end
    end
  end
end
