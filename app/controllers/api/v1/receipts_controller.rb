require "digest"

module Api
  module V1
    class ReceiptsController < ApplicationController
      def upload
        file = params[:file]
        digest = Digest::SHA256.file(file.tempfile).hexdigest
        url = LihkgUploadService.call(file)
        render json: { data: { url: url, sha256: digest } }, status: :created
      rescue LihkgUploadService::InvalidFile => e
        render_error(code: "validation_error", message: e.message, status: :unprocessable_content)
      rescue LihkgUploadService::CircuitOpen, LihkgUploadService::UpstreamError => e
        Rails.logger.error({ event: "lihkg_upload_failed", error: e.message, request_id: request.request_id }.to_json)
        render_error(code: "upstream_error", message: e.message, status: :bad_gateway)
      rescue NoMethodError
        render_error(code: "validation_error", message: "file is required", status: :unprocessable_content)
      end
    end
  end
end
