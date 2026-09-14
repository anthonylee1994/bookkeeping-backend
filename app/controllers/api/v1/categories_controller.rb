module Api
  module V1
    class CategoriesController < ApplicationController
      def index
        categories = current_user.categories
        categories = categories.where(kind: params[:kind]) if params[:kind].present?
        categories = categories.order(:kind, :position, :created_at)
        render json: { data: categories.map { |category| category_payload(category) } }
      rescue ArgumentError => error
        render_invalid_value(error)
      end

      def create
        category = current_user.categories.new(category_params)
        if category.save
          render json: { data: category_payload(category) }, status: :created
        else
          render_validation_error(category)
        end
      rescue ArgumentError => error
        render_invalid_value(error)
      end

      def update
        category = current_user.categories.find(params[:id])
        if category.update(category_params)
          render json: { data: category_payload(category) }
        else
          render_validation_error(category)
        end
      rescue ArgumentError => error
        render_invalid_value(error)
      end

      def destroy
        current_user.categories.find(params[:id]).destroy!
        head :no_content
      end

      private

      def category_params
        params.permit(:name, :kind, :icon, :color, :position)
      end

      def category_payload(category)
        category.as_json(only: %i[id name kind icon color position created_at updated_at])
      end

      def render_invalid_value(error)
        render_error(code: "validation_error", message: error.message, status: :unprocessable_content)
      end
    end
  end
end
