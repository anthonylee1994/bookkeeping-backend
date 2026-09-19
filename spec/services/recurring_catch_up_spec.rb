require "rails_helper"

RSpec.describe RecurringCatchUp do
  let(:user) { create(:user) }
  let(:account) { user.accounts.first }
  let(:category) { user.categories.first }
  let(:merchant) { create(:merchant, user: user) }

  def create_due_rule
    create(:recurring_rule, user: user, account: account, category: category, merchant: merchant, next_run_at: 1.hour.ago)
  end

  it "preloads rule associations instead of loading them once per rule" do
    3.times { create_due_rule }

    account_selects = count_queries_matching(/FROM "accounts"/) { described_class.call(user: user) }

    expect(account_selects).to eq(1)
  end

  it "materializes one transaction per due rule" do
    create_due_rule

    expect { described_class.call(user: user) }.to change { user.transactions.count }.by(1)
  end
end
