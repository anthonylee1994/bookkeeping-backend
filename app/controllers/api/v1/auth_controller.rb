module Api
  module V1
    class AuthController < ApplicationController
      skip_before_action :authenticate_user!

      def register
        user = User.new(auth_params)
        if user.save
          render_auth(user, status: :created)
        else
          render_validation_error(user)
        end
      rescue ActiveRecord::RecordNotUnique
        render_error(
          code: "validation_error",
          message: I18n.t("api.errors.username_taken"),
          details: { username: [ I18n.t("errors.messages.taken") ] },
          status: :unprocessable_content
        )
      end

      def login
        user = User.find_by(username: auth_params[:username].to_s.strip.downcase)
        unless user&.authenticate(auth_params[:password].to_s)
          return render_error(
            code: "invalid_credentials",
            message: I18n.t("api.errors.invalid_credentials"),
            status: :unauthorized
          )
        end

        render_auth(user)
      end

      private

      def auth_params
        params.permit(:username, :password)
      end

      def render_auth(user, status: :ok)
        render json: {
          data: {
            token: JsonWebToken.encode(user.id),
            user: user_payload(user)
          }
        }, status: status
      end
    end
  end
end
