require "rails_helper"

RSpec.describe "Phase 6 dashboard and summaries", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }
  let(:account) { user.accounts.first }
  let(:category) { create(:category, user: user, name: "Food", kind: :expense) }

  def create_transaction(attrs = {})
    create(:transaction, { user: user, account: account, occurred_at: Time.zone.parse("2026-09-14 12:00:00"), currency: "HKD" }.merge(attrs))
  end

  it "calculates daily totals, categories, and excludes transfers" do
    create_transaction(kind: :income, amount_cents: 100_000)
    create_transaction(kind: :expense, amount_cents: 50_000, category: category)
    other = create(:account, user: user, name: "Savings")
    create_transaction(kind: :transfer, amount_cents: 20_000, transfer_account: other)

    get "/api/v1/summaries/daily", params: { date: "2026-09-14" }, headers: headers

    expect(response).to have_http_status(:ok)
    data = json.fetch("data")
    expect(data.values_at("income_cents", "expense_cents", "net_cents")).to eq([100_000, 50_000, 50_000])
    expect(data.dig("transfers", "count")).to eq(1)
    expect(data.dig("transfers", "total_cents")).to eq(20_000)
    expect(data.dig("by_category", 0).fetch("expense_cents")).to eq(50_000)
    expect(data.fetch("by_category").map { |row| row.fetch("income_cents") }.sum).to eq(100_000)
  end

  it "uses Hong Kong time for daily boundaries" do
    create_transaction(kind: :income, amount_cents: 1_000, occurred_at: Time.zone.parse("2026-09-14 23:59:59"))
    create_transaction(kind: :income, amount_cents: 2_000, occurred_at: Time.zone.parse("2026-09-15 00:00:00"))

    get "/api/v1/summaries/daily", params: { date: "2026-09-14" }, headers: headers
    expect(json.dig("data", "income_cents")).to eq(1_000)
    get "/api/v1/summaries/daily", params: { date: "2026-09-15" }, headers: headers
    expect(json.dig("data", "income_cents")).to eq(2_000)
  end

  it "returns Monday through Sunday for weekly summaries and month boundaries" do
    create_transaction(kind: :income, amount_cents: 1_000, occurred_at: Time.zone.parse("2026-09-13 23:59:59"))
    create_transaction(kind: :income, amount_cents: 2_000, occurred_at: Time.zone.parse("2026-09-14 00:00:00"))
    create_transaction(kind: :income, amount_cents: 3_000, occurred_at: Time.zone.parse("2026-09-20 23:59:59"))
    create_transaction(kind: :income, amount_cents: 4_000, occurred_at: Time.zone.parse("2026-09-21 00:00:00"))

    get "/api/v1/summaries/weekly", params: { date: "2026-09-14" }, headers: headers
    expect(json.dig("data", "income_cents")).to eq(5_000)
    get "/api/v1/summaries/weekly", params: { date: "2026-09-21" }, headers: headers
    expect(json.dig("data", "income_cents")).to eq(4_000)

    create_transaction(kind: :income, amount_cents: 5_000, occurred_at: Time.zone.parse("2026-09-30 23:59:59"))
    create_transaction(kind: :income, amount_cents: 6_000, occurred_at: Time.zone.parse("2026-10-01 00:00:00"))
    get "/api/v1/summaries/monthly", params: { date: "2026-09-14" }, headers: headers
    expect(json.dig("data", "income_cents")).to eq(15_000)
  end

  it "paginates summary transactions" do
    3.times { |i| create_transaction(kind: :expense, amount_cents: i + 1_000, occurred_at: Time.zone.parse("2026-09-14 #{10 + i}:00:00")) }
    get "/api/v1/summaries/daily", params: { date: "2026-09-14", page: 2, per_page: 2 }, headers: headers
    transactions = json.dig("data", "transactions")
    expect(transactions.dig("data").size).to eq(1)
    expect(transactions.dig("meta", "total")).to eq(3)
    expect(transactions.dig("meta", "total_pages")).to eq(2)
  end

  it "returns a daily breakdown for monthly summaries" do
    create_transaction(kind: :income, amount_cents: 1_000, occurred_at: Time.zone.parse("2026-09-01 10:00:00"))
    create_transaction(kind: :expense, amount_cents: 400, occurred_at: Time.zone.parse("2026-09-01 11:00:00"))
    create_transaction(kind: :income, amount_cents: 2_000, occurred_at: Time.zone.parse("2026-09-03 09:00:00"))
    other = create(:account, user: user, name: "Savings")
    create_transaction(kind: :transfer, amount_cents: 5_000, transfer_account: other, occurred_at: Time.zone.parse("2026-09-03 12:00:00"))

    get "/api/v1/summaries/monthly", params: { date: "2026-09-14" }, headers: headers

    expect(response).to have_http_status(:ok)
    daily = json.dig("data", "daily")
    expect(daily.map { |row| row.fetch("date") }).to eq([ "2026-09-01", "2026-09-03" ])
    expect(daily.first.fetch("net_cents")).to eq(600)
    expect(daily.last.fetch("net_cents")).to eq(2_000)
    expect(daily.first.keys).to contain_exactly("date", "net_cents")
  end

  it "returns dashboard monthly metrics and recurring reminders" do
    create_transaction(kind: :income, amount_cents: 10_000, occurred_at: Time.zone.parse("2026-09-10 12:00:00"))
    create_transaction(kind: :expense, amount_cents: 3_000, occurred_at: Time.zone.parse("2026-09-11 12:00:00"))
    create(:recurring_rule, user: user, account: account, next_run_at: 3.days.from_now, start_on: Date.current)
    create(:recurring_rule, user: user, account: account, next_run_at: 8.days.from_now, start_on: Date.current)

    get "/api/v1/dashboard", params: { date: "2026-09-14" }, headers: headers
    expect(response).to have_http_status(:ok)
    data = json.fetch("data")
    expect(data.values_at("income_cents", "expense_cents", "net_cents")).to eq([10_000, 3_000, 7_000])
    expect(data.fetch("recent_transactions").size).to eq(2)
    expect(data.fetch("recurring_reminders").size).to eq(1)
    expect(data.dig("by_category", 0).values_at("income_cents", "expense_cents")).to eq([10_000, 3_000])
  end
end
