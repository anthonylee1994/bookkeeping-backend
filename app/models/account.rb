class Account < ApplicationRecord
  belongs_to :user

  enum :kind, { cash: 0, bank: 1, credit_card: 2, e_wallet: 3, other: 4 }

  validates :name, presence: true, uniqueness: { scope: :user_id }
  validates :kind, presence: true
  validates :initial_balance_cents, numericality: { only_integer: true }
  validates :currency, presence: true

  def in_use?
    association_in_use?(:transactions, :account_id) ||
      association_in_use?(:transactions, :transfer_account_id) ||
      association_in_use?(:recurring_rules, :account_id)
  end

  private

  def association_in_use?(table, foreign_key)
    return false unless self.class.connection.data_source_exists?(table)

    self.class.connection.select_value(
      self.class.sanitize_sql_array([ "SELECT 1 FROM #{table} WHERE #{foreign_key} = ? LIMIT 1", id ])
    ).present?
  end
end
