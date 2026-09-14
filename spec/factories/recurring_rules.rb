FactoryBot.define do
  factory :recurring_rule do
    association :user
    account { user.accounts.first || association(:account, user: user) }
    kind { :expense }
    amount_cents { 1_000 }
    frequency { :daily }
    interval { 1 }
    start_on { Date.current }
    next_run_at { Time.zone.now }
    status { :active }
  end
end
