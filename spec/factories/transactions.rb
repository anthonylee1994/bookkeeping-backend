FactoryBot.define do
  factory :transaction do
    association :user
    account { user.accounts.first || association(:account, user: user) }
    kind { :expense }
    amount_cents { 1_000 }
    occurred_at { Time.zone.now }
    source { :manual }
    image_urls { [] }
  end
end
