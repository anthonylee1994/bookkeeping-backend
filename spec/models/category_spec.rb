require "rails_helper"

RSpec.describe Category, type: :model do
  it "allows the same name for different kinds" do
    user = create(:user)
    create(:category, user: user, name: "Other", kind: :expense)

    expect(build(:category, user: user, name: "Other", kind: :income)).to be_valid
  end
end
