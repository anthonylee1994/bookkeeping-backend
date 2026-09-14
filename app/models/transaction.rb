class Transaction < ApplicationRecord
  belongs_to :user
  belongs_to :account
  belongs_to :category, optional: true
  belongs_to :merchant, optional: true
  belongs_to :refund_of, class_name: "Transaction", optional: true
  belongs_to :transfer_account, class_name: "Account", optional: true
  has_many :refunds, class_name: "Transaction", foreign_key: :refund_of_id, dependent: :destroy
  has_one :recurring_occurrence, dependent: :nullify
  has_one :ai_import_log, foreign_key: :transaction_id, dependent: :nullify

  enum :kind, { income: 0, expense: 1, transfer: 2 }
  enum :source, { manual: 0, recurring: 1, ai: 2, import: 3 }

  validates :amount_cents, numericality: { only_integer: true, greater_than: 0 }
  validates :occurred_at, presence: true
  validates :currency, presence: true
  validate :validate_relationships
  validate :image_urls_are_strings
  validate :associations_belong_to_user

  scope :by_user, ->(user) { where(user: user) }

  private

  def validate_relationships
    if transfer?
      errors.add(:category, :invalid) if category_id.present?
      errors.add(:transfer_account, :blank) if transfer_account_id.blank?
      errors.add(:transfer_account, :invalid) if transfer_account_id == account_id
    elsif transfer_account_id.present?
      errors.add(:transfer_account, :invalid)
    end
  end

  def image_urls_are_strings
    return if image_urls.is_a?(Array) && image_urls.all? { |url| url.is_a?(String) }
    errors.add(:image_urls, :invalid)
  end

  def associations_belong_to_user
    { account: account, category: category, merchant: merchant, transfer_account: transfer_account }.each do |name, record|
      errors.add(name, :invalid) if record && record.user_id != user_id
    end
  end
end
