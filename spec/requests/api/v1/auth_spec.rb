require "rails_helper"

RSpec.describe "Auth", type: :request do
  describe "POST /api/v1/auth/register" do
    it "creates a user and returns a jwt plus uuid user id" do
      post "/api/v1/auth/register",
           params: { username: "Alice", password: "secret123" },
           as: :json

      expect(response).to have_http_status(:created)
      user_id = json.dig("data", "user", "id")
      expect(user_id).to match(
        /\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i
      )
      expect(user_id.length).to eq(36)
      expect(json.dig("data", "user", "username")).to eq("alice")
      expect(json.dig("data", "token")).to be_present
      expect(json.dig("data", "user")).not_to have_key("email")
      expect(User.find(user_id).username).to eq("alice")
    end

    it "ignores email and does not persist it" do
      post "/api/v1/auth/register",
           params: { username: "bob", password: "secret123", email: "bob@example.com" },
           as: :json

      expect(response).to have_http_status(:created)
      expect(User.column_names).not_to include("email")
      expect(json.dig("data", "user")).not_to have_key("email")
    end

    it "rejects a duplicate username regardless of case" do
      create(:user, username: "alice", password: "secret123")

      post "/api/v1/auth/register",
           params: { username: "ALICE", password: "secret123" },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("validation_error")
    end

    it "rejects a password shorter than 8 characters" do
      post "/api/v1/auth/register",
           params: { username: "alice", password: "short" },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(json.dig("error", "code")).to eq("validation_error")
    end
  end

  describe "POST /api/v1/auth/login" do
    before { create(:user, username: "alice", password: "secret123") }

    it "returns a jwt for the correct password" do
      post "/api/v1/auth/login",
           params: { username: "ALICE", password: "secret123" },
           as: :json

      expect(response).to have_http_status(:ok)
      expect(json.dig("data", "token")).to be_present
      expect(json.dig("data", "user", "username")).to eq("alice")
      expect(json.dig("data", "user", "id").length).to eq(36)
    end

    it "returns invalid_credentials for a wrong password" do
      post "/api/v1/auth/login",
           params: { username: "alice", password: "wrong-password" },
           as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(json.dig("error", "code")).to eq("invalid_credentials")
      expect(json.dig("error", "request_id")).to be_present
    end

    it "returns invalid_credentials for an unknown username" do
      post "/api/v1/auth/login",
           params: { username: "nobody", password: "secret123" },
           as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(json.dig("error", "code")).to eq("invalid_credentials")
    end
  end

  describe "absent session endpoints" do
    it "does not expose DELETE /api/v1/auth/logout" do
      delete "/api/v1/auth/logout"
      expect(response).to have_http_status(:not_found)
    end

    it "does not expose /api/v1/sessions" do
      get "/api/v1/sessions"
      expect(response).to have_http_status(:not_found)
    end
  end
end
