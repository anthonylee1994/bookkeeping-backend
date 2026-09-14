require "rails_helper"

RSpec.describe "Transactions", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }
  let(:account) { user.accounts.first }

  def create_transaction(overrides = {})
    post "/api/v1/transactions", params: { account_id: account.id, kind: "expense", amount_cents: 1_000, occurred_at: "2026-09-14T10:00:00+08:00" }.merge(overrides), headers: headers.merge("Idempotency-Key" => "transaction-key"), as: :json
  end

  it "creates and lists a transaction with filters and pagination" do
    create_transaction
    expect(response).to have_http_status(:created)
    get "/api/v1/transactions?kind=expense&per_page=1", headers: headers
    expect(response).to have_http_status(:ok)
    expect(json.dig("data", 0, "amount_cents")).to eq(1_000)
    expect(json.dig("meta", "total")).to eq(1)
  end

  it "rejects invalid transfers" do
    create_transaction(kind: "transfer", category_id: "bad")
    expect(response).to have_http_status(:unprocessable_content)
    expect(json.dig("error", "code")).to eq("validation_error")
  end

  it "is idempotent for repeated create requests" do
    create_transaction
    first_id = json.dig("data", "id")
    create_transaction
    expect(response).to have_http_status(:created)
    expect(json.dig("data", "id")).to eq(first_id)
    expect(user.transactions.count).to eq(1)
  end

  it "rejects reuse of an idempotency key with a different request" do
    create_transaction
    create_transaction(amount_cents: 2_000)
    expect(response).to have_http_status(:unprocessable_content)
    expect(json.dig("error", "code")).to eq("idempotency_conflict")
  end

  it "creates refunds and cascades them when original is deleted" do
    create_transaction
    original_id = json.dig("data", "id")
    post "/api/v1/transactions/#{original_id}/refund", params: { amount_cents: 400 }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(json["net_amount_cents"]).to eq(600)
    refund_id = json.dig("data", "id")
    delete "/api/v1/transactions/#{original_id}", headers: headers
    expect(response).to have_http_status(:no_content)
    expect(Transaction.where(id: refund_id)).not_to exist
  end

  it "duplicates a transaction with the current timestamp" do
    create_transaction
    id = json.dig("data", "id")
    post "/api/v1/transactions/#{id}/duplicate", headers: headers
    expect(response).to have_http_status(:created)
    expect(json.dig("data", "id")).not_to eq(id)
  end

  it "does not expose another user's transaction" do
    transaction = create(:transaction)
    get "/api/v1/transactions/#{transaction.id}", headers: headers
    expect(response).to have_http_status(:not_found)
  end
end
