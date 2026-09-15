class Category < ApplicationRecord
  belongs_to :user

  enum :kind, { income: 0, expense: 1 }

  validates :name, presence: true, uniqueness: { scope: [ :user_id, :kind ] }
  validates :kind, presence: true
end
