require "rails_helper"

RSpec.describe "Accounts", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }

  it "lists the current user's default cash account" do
    get "/api/v1/accounts", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch("data").pluck("name")).to include("現金")
    expect(json.fetch("data").pluck("kind")).to include("cash")
  end

  it "creates, updates, and deletes an unused account" do
    post "/api/v1/accounts", params: { name: "銀行", kind: "bank", initial_balance_cents: 500 }, headers: headers, as: :json
    expect(response).to have_http_status(:created)
    account_id = json.dig("data", "id")

    patch "/api/v1/accounts/#{account_id}", params: { name: "儲蓄戶口" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "name")).to eq("儲蓄戶口")

    delete "/api/v1/accounts/#{account_id}", headers: headers
    expect(response).to have_http_status(:no_content)
    expect(Account.where(id: account_id)).not_to exist
  end

  it "does not expose another user's account" do
    account = create(:account)

    patch "/api/v1/accounts/#{account.id}", params: { name: "stolen" }, headers: headers, as: :json

    expect(response).to have_http_status(:not_found)
  end

  it "returns account_in_use when an account has dependent records" do
    account = create(:account, user: user)
    allow_any_instance_of(Account).to receive(:in_use?).and_return(true)

    delete "/api/v1/accounts/#{account.id}", headers: headers

    expect(response).to have_http_status(:unprocessable_content)
    expect(json.dig("error", "code")).to eq("account_in_use")
    expect(Account.where(id: account.id)).to exist
  end
end
