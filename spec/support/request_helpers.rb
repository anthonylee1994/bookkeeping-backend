module RequestHelpers
  def json
    JSON.parse(response.body)
  end

  def auth_headers(user)
    { "Authorization" => "Bearer #{JsonWebToken.encode(user.id)}" }
  end
end

RSpec.configure do |config|
  config.include RequestHelpers, type: :request
end
