class AiImportLog < ApplicationRecord
  belongs_to :user
  belongs_to :transaction_record, class_name: "Transaction", foreign_key: :transaction_id, optional: true

  enum :status, { pending: 0, success: 1, failed: 2, partial: 3 }

  validates :image_sha256, presence: true

  # Keep the API-facing association name aligned with the database column while
  # avoiding ActiveRecord's class-level transaction method.
  def transaction
    transaction_record
  end
end
