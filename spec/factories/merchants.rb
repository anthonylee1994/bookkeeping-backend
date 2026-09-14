FactoryBot.define do
  factory :merchant do
    user
    sequence(:name) { |n| "Merchant #{n}" }
    usage_count { 0 }
  end
end
