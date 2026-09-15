class User < ApplicationRecord
  has_secure_password

  DEFAULT_COLOR = "#ecf0f1"

  has_many :ai_import_logs, dependent: :delete_all
  has_many :recurring_rules, dependent: :delete_all
  has_many :idempotency_keys, dependent: :delete_all
  has_many :transactions, dependent: :delete_all
  has_many :merchants, dependent: :delete_all
  has_many :categories, dependent: :delete_all
  has_many :accounts, dependent: :delete_all

  before_validation :normalize_username

  validates :username, presence: true, uniqueness: { case_sensitive: false }, length: { maximum: 64 }
  validates :password, length: { minimum: 8 }, allow_nil: true
  validates :timezone, presence: true
  validates :currency, presence: true

  after_create :create_default_bookkeeping_records

  private

  def create_default_bookkeeping_records
    accounts.create!(name: "現金", kind: :cash, currency: currency, color: DEFAULT_COLOR)

    [
      [ :expense, %w[飲食 交通 娛樂 購物 醫療 住屋 水電 其他支出] ],
      [ :income, %w[薪水 獎金 投資 兼職 其他收入] ]
    ].each do |kind, names|
      names.each { |name| categories.create!(name: name, kind: kind, color: DEFAULT_COLOR) }
    end
  end

  def normalize_username
    self.username = username.to_s.strip.downcase.presence
  end
end
