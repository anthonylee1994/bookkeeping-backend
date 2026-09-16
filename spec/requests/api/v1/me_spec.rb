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

  describe "PATCH /api/v1/me/password" do
    it "changes the password when the current password is correct" do
      patch "/api/v1/me/password",
            params: {
              password_challenge: "secret123",
              password: "newsecret123",
              password_confirmation: "newsecret123"
            },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:ok)
      expect(json.dig("data", "username")).to eq("alice")
      expect(user.reload.authenticate("newsecret123")).to eq(user)
      expect(user.authenticate("secret123")).to be(false)
    end

    it "allows logging in with the new password afterwards" do
      patch "/api/v1/me/password",
            params: { password_challenge: "secret123", password: "newsecret123" },
            headers: auth_headers(user),
            as: :json
      expect(response).to have_http_status(:ok)

      post "/api/v1/auth/login",
           params: { username: "alice", password: "newsecret123" },
           as: :json

      expect(response).to have_http_status(:ok)
      expect(json.dig("data", "token")).to be_present
    end

    it "rejects a wrong current password without changing anything" do
      patch "/api/v1/me/password",
            params: { password_challenge: "wrong-password", password: "newsecret123" },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("invalid_current_password")
      expect(json.dig("error", "message")).to eq("目前密碼不正確")
      expect(user.reload.authenticate("secret123")).to eq(user)
    end

    it "rejects a missing current password" do
      patch "/api/v1/me/password",
            params: { password: "newsecret123" },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("invalid_current_password")
    end

    it "rejects a new password shorter than 8 characters" do
      patch "/api/v1/me/password",
            params: { password_challenge: "secret123", password: "short" },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("validation_error")
      expect(json.dig("error", "message")).to eq("密碼至少需要 8 個字元")
      expect(user.reload.authenticate("secret123")).to eq(user)
    end

    it "rejects a mismatched password confirmation" do
      patch "/api/v1/me/password",
            params: {
              password_challenge: "secret123",
              password: "newsecret123",
              password_confirmation: "different123"
            },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("validation_error")
    end

    it "rejects a missing new password" do
      patch "/api/v1/me/password",
            params: { password_challenge: "secret123" },
            headers: auth_headers(user),
            as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("validation_error")
    end

    it "returns unauthorized without a token" do
      patch "/api/v1/me/password",
            params: { password_challenge: "secret123", password: "newsecret123" },
            as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(json.dig("error", "code")).to eq("unauthorized")
    end
  end
end
