class Merchant < ApplicationRecord
  belongs_to :user
  belongs_to :default_category, class_name: "Category", optional: true

  validates :name, presence: true, uniqueness: { scope: :user_id }
  validates :usage_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :default_category_belongs_to_user

  private

  def default_category_belongs_to_user
    return if default_category.nil? || default_category.user_id == user_id

    errors.add(:default_category, :invalid)
  end
end
