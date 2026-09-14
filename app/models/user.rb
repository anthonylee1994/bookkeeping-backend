class User < ApplicationRecord
  has_secure_password

  has_many :accounts, dependent: :destroy
  has_many :categories, dependent: :destroy
  has_many :merchants, dependent: :destroy
  has_many :transactions, dependent: :destroy
  has_many :idempotency_keys, dependent: :destroy
  has_many :recurring_rules, dependent: :destroy
  has_many :ai_import_logs, dependent: :destroy

  before_validation :normalize_username

  validates :username, presence: true, uniqueness: { case_sensitive: false }, length: { maximum: 64 }
  validates :password, length: { minimum: 8 }, allow_nil: true
  validates :timezone, presence: true
  validates :currency, presence: true

  after_create :create_default_bookkeeping_records

  private

  def create_default_bookkeeping_records
    accounts.create!(name: "現金", kind: :cash, currency: currency)

    [
      [ :expense, %w[飲食 交通 娛樂 購物 醫療 住屋 水電 其他支出] ],
      [ :income, %w[薪水 獎金 投資 兼職 其他收入] ]
    ].each do |kind, names|
      names.each_with_index { |name, index| categories.create!(name: name, kind: kind, position: index) }
    end
  end

  def normalize_username
    self.username = username.to_s.strip.downcase.presence
  end
end
