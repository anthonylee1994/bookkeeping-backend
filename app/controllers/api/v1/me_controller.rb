module Api
  module V1
    class MeController < ApplicationController
      def show
        render json: { data: user_payload(current_user) }
      end
    end
  end
end
