require "rails_helper"

RSpec.describe Merchant, type: :model do
  it "rejects a default category owned by another user" do
    merchant = build(:merchant, default_category: create(:category))

    expect(merchant).not_to be_valid
    expect(merchant.errors[:default_category]).to be_present
  end
end
