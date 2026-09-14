require "rails_helper"

RSpec.describe Account, type: :model do
  it "uses a uuid and supports the specified kinds" do
    account = create(:account, kind: :e_wallet)

    expect(account.id).to match(/\A[0-9a-f-]{36}\z/)
    expect(account).to be_e_wallet
    expect(described_class.kinds.keys).to eq(%w[cash bank credit_card e_wallet other])
  end

  it "requires names to be unique within a user" do
    account = create(:account)
    duplicate = build(:account, user: account.user, name: account.name)

    expect(duplicate).not_to be_valid
  end

  it "checks both transaction account columns and recurring rules when their tables exist" do
    account = create(:account)
    connection = described_class.connection
    allow(connection).to receive(:data_source_exists?).and_return(true)
    allow(connection).to receive(:select_value).and_return(nil, nil, 1)

    expect(account).to be_in_use
    expect(connection).to have_received(:select_value).exactly(3).times
  end
end
