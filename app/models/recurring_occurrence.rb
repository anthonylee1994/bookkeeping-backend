class RecurringOccurrence < ApplicationRecord
  belongs_to :recurring_rule
  belongs_to :transaction_record, class_name: "Transaction", foreign_key: :transaction_id, optional: true
end
