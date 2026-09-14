class User < ApplicationRecord
  has_secure_password

  before_validation :normalize_username

  validates :username, presence: true, uniqueness: { case_sensitive: false }, length: { maximum: 64 }
  validates :password, length: { minimum: 8 }, allow_nil: true
  validates :timezone, presence: true
  validates :currency, presence: true

  private

  def normalize_username
    self.username = username.to_s.strip.downcase.presence
  end
end
