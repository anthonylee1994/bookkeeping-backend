module Api
  module V1
    class AccountsController < ApplicationController
      def index
        accounts = current_user.accounts.order(:created_at)
        render json: { data: accounts.map { |account| account_payload(account) } }
      end

      def create
        account = current_user.accounts.new(account_params)
        if account.save
          render json: { data: account_payload(account) }, status: :created
        else
          render_validation_error(account)
        end
      rescue ArgumentError => error
        render_invalid_value(error)
      end

      def update
        account = current_user.accounts.find(params[:id])
        if account.update(account_params)
          render json: { data: account_payload(account) }
        else
          render_validation_error(account)
        end
      rescue ArgumentError => error
        render_invalid_value(error)
      end

      def destroy
        account = current_user.accounts.find(params[:id])
        if account.in_use?
          return render_error(
            code: "account_in_use",
            message: I18n.t("api.errors.account_in_use"),
            status: :unprocessable_content
          )
        end

        account.destroy!
        head :no_content
      rescue ActiveRecord::InvalidForeignKey
        render_error(
          code: "account_in_use",
          message: I18n.t("api.errors.account_in_use"),
          status: :unprocessable_content
        )
      end

      private

      def account_params
        params.permit(:name, :kind, :icon, :color, :initial_balance_cents, :currency)
      end

      def account_payload(account)
        account.as_json(only: %i[id name kind icon color initial_balance_cents currency created_at updated_at])
      end

      def render_invalid_value(error)
        render_error(code: "validation_error", message: error.message, status: :unprocessable_content)
      end
    end
  end
end
