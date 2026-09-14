# Be sure to restart your server when you modify this file.

Rails.application.configure do
  config.lograge.enabled = !Rails.env.test?
  config.lograge.formatter = Lograge::Formatters::Json.new
  config.lograge.custom_payload do |controller|
    payload = { request_id: controller.request.request_id }
    if controller.respond_to?(:current_user) && controller.current_user
      payload[:user_id] = controller.current_user.id
    end
    payload
  end
end
