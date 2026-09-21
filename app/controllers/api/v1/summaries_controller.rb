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
        date = params[:date].present? ? Date.iso8601(params[:date].to_s) : Time.zone.today
        from, to = boundaries(period, date)
        scope = current_user.transactions.where(occurred_at: from..to)
        regular = scope.where.not(kind: :transfer)
        income = regular.where(kind: :income).sum(:amount_cents)
        expense = regular.where(kind: :expense).sum(:amount_cents)
        render json: { data: {
          range: { from: from.iso8601, to: to.iso8601 }, income_cents: income, expense_cents: expense,
          net_cents: income - expense,
          daily: daily_breakdown(regular),
          by_category: by_category(regular), by_account: by_account(regular),
          transfers: { count: scope.where(kind: :transfer).count, total_cents: scope.where(kind: :transfer).sum(:amount_cents) },
          transactions: paginated_transactions(regular)
        } }
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

      def daily_breakdown(scope)
        scope.group_by { |transaction| transaction.occurred_at.in_time_zone.to_date }.sort.map do |day, rows|
          income = rows.select { |transaction| transaction.kind == "income" }.sum(&:amount_cents)
          expense = rows.select { |transaction| transaction.kind == "expense" }.sum(&:amount_cents)
          { date: day.iso8601, net_cents: income - expense }
        end
      end

      def by_category(scope)
        income_totals = scope.where(kind: :income).group(:category_id).sum(:amount_cents)
        expense_totals = scope.where(kind: :expense).group(:category_id).sum(:amount_cents)
        category_ids = income_totals.keys | expense_totals.keys
        categories = current_user.categories.where(id: category_ids).index_by(&:id)
        category_ids.map do |category_id|
          { category_id: category_id, name: categories[category_id]&.name, income_cents: income_totals[category_id] || 0, expense_cents: expense_totals[category_id] || 0 }
        end.sort_by { |row| [ -row[:expense_cents], -row[:income_cents] ] }
      end

      def by_account(scope)
        income_totals = scope.where(kind: :income).group(:account_id).sum(:amount_cents)
        expense_totals = scope.where(kind: :expense).group(:account_id).sum(:amount_cents)
        account_ids = income_totals.keys | expense_totals.keys
        accounts = current_user.accounts.where(id: account_ids).index_by(&:id)
        account_ids.map do |account_id|
          { account_id: account_id, name: accounts[account_id]&.name, income_cents: income_totals[account_id] || 0, expense_cents: expense_totals[account_id] || 0 }
        end
      end

      def paginated_transactions(scope)
        page = [ params.fetch(:page, 1).to_i, 1 ].max
        per_page = [ params.fetch(:per_page, 25).to_i, 1 ].max.clamp(1, 100)
        total = scope.count
        rows = scope.order(occurred_at: :desc).offset((page - 1) * per_page).limit(per_page)
        { data: rows.map { |tx| tx.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note payment_method image_urls source transfer_account_id]) }, meta: { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil } }
      end
    end
  end
end
