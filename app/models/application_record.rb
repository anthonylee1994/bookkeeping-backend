class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class

  # UUID v4 PKs are random; order by created_at instead of id.
  self.implicit_order_column = "created_at"

  before_create :assign_uuid

  private

  def assign_uuid
    self.id ||= SecureRandom.uuid
  end
end
