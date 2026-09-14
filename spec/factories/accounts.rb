FactoryBot.define do
  factory :account do
    user
    sequence(:name) { |n| "Account #{n}" }
    kind { :bank }
    initial_balance_cents { 0 }
    currency { "HKD" }
  end
end
