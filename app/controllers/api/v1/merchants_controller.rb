module Api
  module V1
    class MerchantsController < ApplicationController
      def index
        merchants = current_user.merchants
        if params[:q].present?
          query = ActiveRecord::Base.sanitize_sql_like(params[:q].to_s)
          merchants = merchants.where("name LIKE ?", "%#{query}%").order(usage_count: :desc, name: :asc).limit(10)
        else
          merchants = merchants.order(usage_count: :desc, name: :asc)
        end
        render json: { data: merchants.map { |merchant| merchant_payload(merchant) } }
      end

      def create
        merchant = current_user.merchants.new(merchant_params)
        if merchant.save
          render json: { data: merchant_payload(merchant) }, status: :created
        else
          render_validation_error(merchant)
        end
      end

      def update
        merchant = current_user.merchants.find(params[:id])
        if merchant.update(merchant_params)
          render json: { data: merchant_payload(merchant) }
        else
          render_validation_error(merchant)
        end
      end

      def destroy
        current_user.merchants.find(params[:id]).destroy!
        head :no_content
      end

      private

      def merchant_params
        params.permit(:name, :default_category_id)
      end

      def merchant_payload(merchant)
        merchant.as_json(only: %i[id name default_category_id usage_count created_at updated_at])
      end
    end
  end
end
