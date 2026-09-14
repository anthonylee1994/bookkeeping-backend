FactoryBot.define do
  factory :user do
    sequence(:username) { |n| "user#{n}" }
    password { "secret123" }
  end
end
