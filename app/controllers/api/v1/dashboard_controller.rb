module Api
  module V1
    class DashboardController < ApplicationController
      def show
        Time.use_zone("Asia/Hong_Kong") do
          now = Time.zone.now
          date = params[:date].present? ? Date.iso8601(params[:date].to_s) : now.to_date
          from = date.beginning_of_month.in_time_zone
          to = date.end_of_month.end_of_day
          transactions = current_user.transactions.where(occurred_at: from..to)
          expense = transactions.where(kind: :expense, refund_of_id: nil).sum(:amount_cents)
          refund = transactions.where(kind: :expense).where.not(refund_of_id: nil).sum(:amount_cents)
          income = transactions.where(kind: :income).sum(:amount_cents)
          balances = account_balances
          reminders = upcoming_rules(now)

          render json: { data: {
            range: { from: from.iso8601, to: to.iso8601 },
            income_cents: income,
            expense_cents: expense,
            refund_cents: refund,
            net_expense_cents: expense - refund,
            net_cents: income - expense + refund,
            recent_transactions: transaction_rows(current_user.transactions.order(occurred_at: :desc).limit(10)),
            by_category: category_breakdown(transactions),
            accounts: balances,
            account_balances: balances,
            upcoming_recurring: reminders,
            recurring_reminders: reminders
          } }
        end
      rescue Date::Error
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      private

      def category_breakdown(scope)
        rows = scope.where(kind: :expense).group(:category_id).select(:category_id)
        rows.map do |row|
          category = current_user.categories.find_by(id: row.category_id)
          items = scope.where(kind: :expense, category_id: row.category_id)
          { category_id: row.category_id, name: category&.name, expense_cents: items.where(refund_of_id: nil).sum(:amount_cents), refund_cents: items.where.not(refund_of_id: nil).sum(:amount_cents) }
        end.sort_by { |x| -(x[:expense_cents] + x[:refund_cents]) }.first(5)
      end

      def account_balances
        current_user.accounts.order(:created_at).map do |account|
          tx = current_user.transactions.where(account_id: account.id)
          income = tx.where(kind: :income).sum(:amount_cents)
          expense = tx.where(kind: :expense, refund_of_id: nil).sum(:amount_cents)
          refund = tx.where(kind: :expense).where.not(refund_of_id: nil).sum(:amount_cents)
          { id: account.id, name: account.name, currency: account.currency, initial_balance_cents: account.initial_balance_cents, balance_cents: account.initial_balance_cents + income - expense + refund }
        end
      end

      def transaction_rows(rows)
        rows.map { |transaction| transaction.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note payment_method image_urls source refund_of_id transfer_account_id]).merge("net_amount_cents" => transaction.amount_cents - transaction.refunds.sum(:amount_cents)) }
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
