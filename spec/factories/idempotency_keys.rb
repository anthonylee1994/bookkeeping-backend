FactoryBot.define do
  factory :idempotency_key do
    association :user
    key { SecureRandom.hex(8) }
    request_hash { SecureRandom.hex(32) }
  end
end
