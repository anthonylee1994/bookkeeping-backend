require "rails_helper"

RSpec.describe "Recurring rules", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }
  let(:account) { user.accounts.first }

  def rule_params(overrides = {})
    { account_id: account.id, kind: "expense", amount_cents: 1_000, frequency: "daily", interval: 1, start_on: Date.current.to_s, next_run_at: 1.hour.from_now }.merge(overrides)
  end

  it "creates and pauses/resumes a rule" do
    post "/api/v1/recurring_rules", params: rule_params, headers: headers, as: :json
    expect(response).to have_http_status(:created)
    id = json.dig("data", "id")
    post "/api/v1/recurring_rules/#{id}/pause", headers: headers
    expect(json.dig("data", "status")).to eq("paused")
    post "/api/v1/recurring_rules/#{id}/resume", headers: headers
    expect(json.dig("data", "status")).to eq("active")
  end

  it "lists all rules and filters by status" do
    create(:recurring_rule, user: user, account: account, status: :active, note: "active rule")
    create(:recurring_rule, user: user, account: account, status: :paused, note: "paused rule")

    get "/api/v1/recurring_rules", headers: headers
    expect(response).to have_http_status(:ok)
    expect(json["data"].map { |rule| rule["note"] }).to contain_exactly("active rule", "paused rule")

    get "/api/v1/recurring_rules", params: { status: "paused" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json["data"].map { |rule| rule["note"] }).to contain_exactly("paused rule")

    get "/api/v1/recurring_rules", params: { status: "ended" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json["data"]).to be_empty

    get "/api/v1/recurring_rules", params: { status: "bogus" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json["data"]).to be_empty
  end

  it "runs now once and rejects a second materialization" do
    post "/api/v1/recurring_rules", params: rule_params(next_run_at: 1.hour.from_now), headers: headers, as: :json
    id = json.dig("data", "id")
    post "/api/v1/recurring_rules/#{id}/run_now", headers: headers
    expect(response).to have_http_status(:ok)
    post "/api/v1/recurring_rules/#{id}/run_now", headers: headers
    expect(response).to have_http_status(:conflict)
    expect(json.dig("error", "code")).to eq("already_materialized")
  end

  it "catches up a due rule exactly once" do
    rule = create(:recurring_rule, user: user, account: account, next_run_at: 2.days.ago)
    get "/api/v1/me", headers: headers
    expect(response).to have_http_status(:ok)
    expect(rule.reload.recurring_occurrences.count).to be >= 1
    count = user.transactions.where(source: :recurring).count
    get "/api/v1/me", headers: headers
    expect(user.transactions.where(source: :recurring).count).to eq(count)
  end

  it "skips the next occurrence without creating a transaction" do
    rule = create(:recurring_rule, user: user, account: account, next_run_at: 1.hour.from_now)
    post "/api/v1/recurring_rules/#{rule.id}/skip_next", headers: headers
    expect(response).to have_http_status(:ok)
    expect(rule.reload.recurring_occurrences.last.transaction_id).to be_nil
  end

  it "does not recreate a deleted recurring transaction" do
    rule = create(:recurring_rule, user: user, account: account, next_run_at: 1.hour.ago)
    get "/api/v1/me", headers: headers
    recurring_transaction = user.transactions.where(source: :recurring).first
    delete "/api/v1/transactions/#{recurring_transaction.id}", headers: headers
    get "/api/v1/me", headers: headers
    expect(user.transactions.where(source: :recurring)).to be_empty
    expect(rule.recurring_occurrences.where(transaction_id: nil)).to exist
  end

  it "ends a rule after its end date" do
    rule = create(:recurring_rule, user: user, account: account, next_run_at: 2.days.ago, end_on: 1.day.ago)
    get "/api/v1/me", headers: headers
    expect(rule.reload.status).to eq("ended")
  end

  it "backfills only the latest due occurrence by default" do
    rule = create(:recurring_rule, user: user, account: account, next_run_at: 3.days.ago)
    RecurringCatchUp.call(user: user)
    expect(rule.reload.recurring_occurrences.count).to eq(4)
    expect(user.transactions.where(source: :recurring).count).to eq(1)
  end

  it "backfills due occurrences when enabled" do
    previous = ENV["RECURRING_BACKFILL_ENABLED"]
    ENV["RECURRING_BACKFILL_ENABLED"] = "true"
    begin
      rule = create(:recurring_rule, user: user, account: account, next_run_at: 3.days.ago)
      RecurringCatchUp.call(user: user)
      expect(rule.reload.recurring_occurrences.count).to eq(4)
      expect(user.transactions.where(source: :recurring).count).to eq(4)
    ensure
      ENV["RECURRING_BACKFILL_ENABLED"] = previous
    end
  end
end
