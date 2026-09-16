module Api
  module V1
    class MeController < ApplicationController
      def show
        render json: { data: user_payload(current_user) }
      end

      def update_password
        unless current_user.authenticate(params[:password_challenge].to_s)
          return render_error(
            code: "invalid_current_password",
            message: I18n.t("api.errors.invalid_current_password"),
            status: :unprocessable_content
          )
        end

        if current_user.update(password_params)
          render json: { data: user_payload(current_user) }
        else
          render_validation_error(current_user)
        end
      end

      private

      def password_params
        params.require(:password)
        params.permit(:password, :password_confirmation)
      end
    end
  end
end
