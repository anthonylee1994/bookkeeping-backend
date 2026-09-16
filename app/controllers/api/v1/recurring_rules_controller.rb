module Api
  module V1
    class RecurringRulesController < ApplicationController
      def index
        rules = current_user.recurring_rules.order(:created_at)
        rules = rules.where(status: params[:status]) if params[:status].present?
        render json: { data: rules.map { |rule| rule_payload(rule) } }
      end

      def create
        rule = current_user.recurring_rules.new(recurring_rule_params)
        rule.next_run_at ||= initial_run_at(rule)
        if rule.save
          render json: { data: rule_payload(rule) }, status: :created
        else
          render_validation_error(rule)
        end
      rescue ArgumentError
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      def update
        rule = current_user.recurring_rules.find(params[:id])
        if rule.update(recurring_rule_params)
          render json: { data: rule_payload(rule) }
        else
          render_validation_error(rule)
        end
      rescue ArgumentError
        render_error(code: "validation_error", message: I18n.t("api.errors.invalid_value"), status: :unprocessable_content)
      end

      def destroy
        current_user.recurring_rules.find(params[:id]).destroy!
        head :no_content
      end

      def pause
        update_status(:paused)
      end

      def resume
        rule = current_user.recurring_rules.find(params[:id])
        rule.update!(status: :active, next_run_at: [ rule.next_run_at, Time.zone.now ].max)
        render json: { data: rule_payload(rule) }
      end

      def run_now
        rule = current_user.recurring_rules.find(params[:id])
        occurred_on = Time.zone.now.to_date
        occurrence = rule.recurring_occurrences.find_by(occurred_on: occurred_on)
        return render_error(code: "already_materialized", message: I18n.t("api.errors.already_materialized"), status: :conflict) if occurrence&.transaction_id.present?
        occurrence ||= rule.recurring_occurrences.create!(occurred_on: occurred_on)
        occurrence.transaction_record = build_transaction(rule, Time.zone.now)
        occurrence.save!
        render json: { data: transaction_payload(occurrence.transaction_record) }
      rescue ActiveRecord::RecordNotUnique
        retry
      end

      def skip_next
        rule = current_user.recurring_rules.find(params[:id])
        occurrence = rule.recurring_occurrences.find_or_create_by!(occurred_on: rule.next_run_at.to_date)
        occurrence.update!(transaction_id: nil)
        rule.update!(last_run_at: Time.zone.now, next_run_at: RecurringRuleCalculator.next_occurrence(from: rule.next_run_at, rule: rule))
        render json: { data: rule_payload(rule) }
      end

      private

      def recurring_rule_params
        params.permit(:account_id, :category_id, :merchant_id, :kind, :amount_cents, :currency, :frequency, :interval, :day_of_week, :day_of_month, :month_of_year, :start_on, :end_on, :next_run_at, :status, :note)
      end

      def initial_run_at(rule)
        Time.zone.parse(rule.start_on.to_s)
      end

      def update_status(status)
        rule = current_user.recurring_rules.find(params[:id])
        rule.update!(status: status)
        render json: { data: rule_payload(rule) }
      end

      def build_transaction(rule, occurred_at)
        Transaction.create!(user: current_user, account: rule.account, category: rule.category, merchant: rule.merchant, kind: rule.kind, amount_cents: rule.amount_cents, currency: rule.currency, occurred_at: occurred_at, note: rule.note, source: :recurring)
      end

      def transaction_payload(transaction)
        transaction.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency occurred_at note source]).merge("net_amount_cents" => transaction.amount_cents)
      end

      def rule_payload(rule)
        rule.as_json(only: %i[id account_id category_id merchant_id kind amount_cents currency frequency interval day_of_week day_of_month month_of_year start_on end_on next_run_at last_run_at status note created_at updated_at])
      end
    end
  end
end
