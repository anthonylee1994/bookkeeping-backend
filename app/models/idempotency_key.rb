class IdempotencyKey < ApplicationRecord
  belongs_to :user
  validates :key, :request_hash, presence: true
end
