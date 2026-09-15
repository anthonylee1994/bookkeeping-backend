require "rails_helper"

RSpec.describe User, type: :model do
  it "assigns a uuid v4 primary key" do
    user = create(:user)
    expect(user.id).to match(
      /\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i
    )
    expect(user.id.length).to eq(36)
  end

  it "does not have an email column" do
    expect(described_class.column_names).not_to include("email")
    expect { described_class.new(email: "a@b.c") }.to raise_error(ActiveModel::UnknownAttributeError)
  end

  it "stores username in lowercase" do
    user = create(:user, username: "Alice")
    expect(user.username).to eq("alice")
  end

  it "treats usernames case-insensitively as the same user" do
    create(:user, username: "Alice")
    duplicate = described_class.new(username: "ALICE", password: "secret123")
    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:username]).to include("已被使用")
  end

  it "requires a password of at least 8 characters" do
    user = described_class.new(username: "alice", password: "short")
    expect(user).not_to be_valid
    expect(user.errors[:password]).to be_present
  end

  it "authenticates with the correct password" do
    user = create(:user, password: "secret123")
    expect(user.authenticate("secret123")).to eq(user)
    expect(user.authenticate("wrong")).to be(false)
  end

  it "defaults timezone and currency" do
    user = create(:user)
    expect(user.timezone).to eq("Asia/Hong_Kong")
    expect(user.currency).to eq("HKD")
  end

  it "deletes every dependent record when destroyed" do
    user = create(:user)
    account = user.accounts.first
    category = user.categories.first
    merchant = create(:merchant, user: user)
    create(:transaction, user: user, account: account, category: category, merchant: merchant)
    create(:transaction, user: user, account: account, kind: :transfer, transfer_account: create(:account, user: user))
    rule = create(:recurring_rule, user: user, account: account, category: category, merchant: merchant)
    rule.recurring_occurrences.create!(occurred_on: Date.current)
    create(:idempotency_key, user: user)
    user.ai_import_logs.create!(image_sha256: "abc123")

    user.destroy!

    expect(Account.where(user_id: user.id)).to be_empty
    expect(Category.where(user_id: user.id)).to be_empty
    expect(Merchant.where(user_id: user.id)).to be_empty
    expect(Transaction.where(user_id: user.id)).to be_empty
    expect(RecurringRule.where(user_id: user.id)).to be_empty
    expect(RecurringOccurrence.where(recurring_rule_id: rule.id)).to be_empty
    expect(IdempotencyKey.where(user_id: user.id)).to be_empty
    expect(AiImportLog.where(user_id: user.id)).to be_empty
  end
end
