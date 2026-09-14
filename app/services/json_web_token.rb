class JsonWebToken
  def self.encode(user_id)
    JWT.encode(
      { "user_id" => user_id.to_s, "iat" => Time.now.to_i },
      secret,
      "HS256"
    )
  end

  def self.decode(token)
    payload, = JWT.decode(
      token,
      secret,
      true,
      { verify_expiration: false, algorithm: "HS256" }
    )
    payload
  rescue JWT::DecodeError, JWT::VerificationError
    nil
  end

  def self.secret
    ENV.fetch("JWT_SECRET")
  end
  private_class_method :secret
end
