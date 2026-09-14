Rswag::Api.configure do |config|
  if config.respond_to?(:openapi_root=)
    config.openapi_root = Rails.root.join("swagger").to_s
  elsif config.respond_to?(:swagger_root=)
    config.swagger_root = Rails.root.join("swagger").to_s
  end
end
