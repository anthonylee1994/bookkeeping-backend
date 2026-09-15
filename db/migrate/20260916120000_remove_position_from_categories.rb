class RemovePositionFromCategories < ActiveRecord::Migration[8.1]
  def change
    remove_column :categories, :position, :integer
  end
end
