FactoryBot.define do
  factory :category do
    user
    sequence(:name) { |n| "Category #{n}" }
    kind { :expense }
    position { 0 }
  end
end
