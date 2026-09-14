Rswag::Api.configure do |config|
  if config.respond_to?(:openapi_root=)
    config.openapi_root = Rails.root.join("swagger").to_s
  elsif config.respond_to?(:swagger_root=)
    config.swagger_root = Rails.root.join("swagger").to_s
  end
end

Rswag::Ui.configure do |config|
  config.openapi_endpoint "/api-docs/v1/swagger.yaml", "Bookkeeping API V1"
end
