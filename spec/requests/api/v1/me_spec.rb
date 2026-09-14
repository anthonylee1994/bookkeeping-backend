require "rails_helper"

RSpec.describe "Me", type: :request do
  let(:user) { create(:user, username: "alice", password: "secret123") }

  it "returns the current user" do
    get "/api/v1/me", headers: auth_headers(user)

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "id")).to eq(user.id)
    expect(json.dig("data", "username")).to eq("alice")
    expect(json.dig("data", "timezone")).to eq("Asia/Hong_Kong")
    expect(json.dig("data", "currency")).to eq("HKD")
  end

  it "returns unauthorized without a token" do
    get "/api/v1/me"

    expect(response).to have_http_status(:unauthorized)
    expect(json.dig("error", "code")).to eq("unauthorized")
  end

  it "returns unauthorized for a malformed token" do
    get "/api/v1/me", headers: { "Authorization" => "Bearer not-a-jwt" }

    expect(response).to have_http_status(:unauthorized)
    expect(json.dig("error", "code")).to eq("unauthorized")
  end

  it "returns unauthorized for a token signed with a different secret" do
    token = JWT.encode(
      { "user_id" => user.id, "iat" => Time.now.to_i },
      "forged-secret",
      "HS256"
    )
    get "/api/v1/me", headers: { "Authorization" => "Bearer #{token}" }

    expect(response).to have_http_status(:unauthorized)
    expect(json.dig("error", "code")).to eq("unauthorized")
  end

  it "returns unauthorized when the user no longer exists" do
    headers = auth_headers(user)
    user.destroy!

    get "/api/v1/me", headers: headers

    expect(response).to have_http_status(:unauthorized)
    expect(json.dig("error", "code")).to eq("unauthorized")
  end

  it "accepts the same token from two requests" do
    headers = auth_headers(user)

    get "/api/v1/me", headers: headers
    expect(response).to have_http_status(:ok)
    first_id = json.dig("data", "id")

    get "/api/v1/me", headers: headers
    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "id")).to eq(first_id)
  end
end
