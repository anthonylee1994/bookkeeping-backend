# Be sure to restart your server when you modify this file.

# Avoid CORS issues when API is called from the frontend app.
# Handle Cross-Origin Resource Sharing (CORS) in order to accept cross-origin Ajax requests.
#
# Origins come from CORS_ORIGINS (comma-separated). Empty means no origin is allowed.

# Read more: https://github.com/cyu/rack-cors

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allowed = ENV.fetch("CORS_ORIGINS", "").split(",").map(&:strip).reject(&:empty?)

  if allowed.any?
    allow do
      origins(*allowed)

      resource "*",
        headers: :any,
        methods: %i[get post put patch delete options head],
        expose: %w[Authorization X-Request-Id]
    end
  end
end
