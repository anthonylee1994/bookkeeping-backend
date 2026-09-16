# Be sure to restart your server when you modify this file.

class Rack::Attack
  Rack::Attack.enabled = !Rails.env.test?

  throttle("auth/login", limit: 5, period: 1.minute) do |req|
    req.ip if req.path == "/api/v1/auth/login" && req.post?
  end

  throttle("auth/password", limit: 5, period: 1.minute) do |req|
    if req.path == "/api/v1/me/password" && (req.patch? || req.put?)
      discriminate_user(req)
    end
  end

  throttle("ai", limit: 10, period: 1.minute) do |req|
    if req.path.start_with?("/api/v1/ai") && req.post?
      discriminate_user(req)
    end
  end

  throttle("upload", limit: 20, period: 1.minute) do |req|
    if req.path == "/api/v1/receipts/upload" && req.post?
      discriminate_user(req)
    end
  end

  self.throttled_responder = lambda do |request|
    [
      429,
      { "content-type" => "application/json" },
      [
        {
          error: {
            code: "rate_limited",
            message: I18n.t("api.errors.rate_limited"),
            request_id: request.env["action_dispatch.request_id"]
          }
        }.to_json
      ]
    ]
  end

  def self.discriminate_user(req)
    auth = req.get_header("HTTP_AUTHORIZATION")
    return req.ip unless auth&.start_with?("Bearer ")

    token = auth.split(" ", 2).last
    payload, = JWT.decode(token, nil, false)
    payload["user_id"] || req.ip
  rescue JWT::DecodeError
    req.ip
  end
end
