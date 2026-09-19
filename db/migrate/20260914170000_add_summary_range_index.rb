class AddSummaryRangeIndex < ActiveRecord::Migration[8.1]
  def change
    add_index :transactions, [ :user_id, :occurred_at, :kind ], if_not_exists: true
  end
end
