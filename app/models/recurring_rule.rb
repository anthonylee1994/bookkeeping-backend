class RecurringRule < ApplicationRecord
  belongs_to :user
  belongs_to :account
  belongs_to :category, optional: true
  belongs_to :merchant, optional: true
  has_many :recurring_occurrences, dependent: :destroy

  enum :kind, { income: 0, expense: 1 }
  enum :frequency, { daily: 0, weekly: 1, monthly: 2, yearly: 3 }
  enum :status, { active: 0, paused: 1, ended: 2 }

  validates :amount_cents, numericality: { only_integer: true, greater_than: 0 }
  validates :interval, numericality: { only_integer: true, greater_than: 0 }
  validates :currency, :start_on, :next_run_at, presence: true
  validates :day_of_week, inclusion: { in: 0..6 }, allow_nil: true
  validates :day_of_month, inclusion: { in: 1..31 }, allow_nil: true
  validates :month_of_year, inclusion: { in: 1..12 }, allow_nil: true
  validate :account_belongs_to_user
  validate :category_and_merchant_belong_to_user

  private

  def account_belongs_to_user
    errors.add(:account, :invalid) if account && account.user_id != user_id
  end

  def category_and_merchant_belong_to_user
    errors.add(:category, :invalid) if category && category.user_id != user_id
    errors.add(:merchant, :invalid) if merchant && merchant.user_id != user_id
  end
end
