module Api
  module V1
    class DashboardController < ApplicationController
      def show
        now = Time.zone.now
        date = params[:date].present? ? Date.iso8601(params[:date].to_s) : now.to_date
        from = date.beginning_of_month.in_time_zone
        to = date.end_of_month.end_of_day
        transactions = current_user.transactions.where(occurred_at: from..to)
        expense = transactions.where(kind: :expense).sum(:amount_cents)
        income = transactions.where(kind: :income).sum(:amount_cents)
        balances = account_balances
        reminders = upcoming_rules(now)

        render json: { data: {
          range: { from: from.iso8601, to: to.iso8601 },
          income_cents: income,
          expense_cents: expense,
          net_cents: income - expense,
          recent_transactions: transaction_rows(current_user.transactions.order(occurred_at: :desc).limit(10)),
          by_category: category_breakdown(transactions),
          accounts: balances,
          account_balances: balances,
          upcoming_recurring: reminders,
          recurring_reminders: reminders
        } }
      rescue Date::Error
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      private

      def category_breakdown(scope)
        regular = scope.where.not(kind: :transfer)
        income_totals = regular.where(kind: :income).group(:category_id).sum(:amount_cents)
        expense_totals = regular.where(kind: :expense).group(:category_id).sum(:amount_cents)
        category_ids = income_totals.keys | expense_totals.keys
        categories = current_user.categories.where(id: category_ids).index_by(&:id)
        category_ids.map do |category_id|
          { category_id: category_id, name: categories[category_id]&.name, income_cents: income_totals[category_id] || 0, expense_cents: expense_totals[category_id] || 0 }
        end.sort_by { |row| [ -row[:expense_cents], -row[:income_cents] ] }
      end

      def account_balances
        accounts = current_user.accounts.order(:created_at)
        income_totals = current_user.transactions.where(kind: :income).group(:account_id).sum(:amount_cents)
        expense_totals = current_user.transactions.where(kind: :expense).group(:account_id).sum(:amount_cents)
        accounts.map do |account|
          income = income_totals[account.id] || 0
          expense = expense_totals[account.id] || 0
          { id: account.id, name: account.name, currency: account.currency, initial_balance_cents: account.initial_balance_cents, balance_cents: account.initial_balance_cents + income - expense }
        end
      end

      def transaction_rows(rows)
        rows.map { |transaction| transaction.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note payment_method image_urls source transfer_account_id]) }
      end

      def rule_payload(rule)
        rule.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency frequency interval day_of_week day_of_month month_of_year start_on end_on next_run_at last_run_at status note])
      end

      def upcoming_rules(now)
        current_user.recurring_rules.where(status: :active, next_run_at: now..(now + 7.days)).order(:next_run_at).map { |rule| rule_payload(rule) }
      end
    end
  end
end
