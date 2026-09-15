class RemoveRefundFromTransactions < ActiveRecord::Migration[8.1]
  def up
    # Expense refunds were money in; income refunds were money out. Flip kind so
    # balances stay the same after the refund association is dropped.
    execute <<~SQL
      UPDATE transactions
      SET kind = CASE kind WHEN 1 THEN 0 WHEN 0 THEN 1 ELSE kind END,
          category_id = NULL
      WHERE refund_of_id IS NOT NULL
    SQL

    remove_foreign_key :transactions, column: :refund_of_id
    remove_index :transactions, :refund_of_id
    remove_column :transactions, :refund_of_id
  end

  def down
    add_reference :transactions, :refund_of, foreign_key: { to_table: :transactions, on_delete: :cascade }, type: :uuid
  end
end
