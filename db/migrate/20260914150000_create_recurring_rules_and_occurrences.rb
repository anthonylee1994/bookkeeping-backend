class CreateRecurringRulesAndOccurrences < ActiveRecord::Migration[8.1]
  def change
    create_table :recurring_rules, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.references :account, null: false, foreign_key: { on_delete: :restrict }, type: :uuid
      t.references :category, foreign_key: { on_delete: :nullify }, type: :uuid
      t.references :merchant, foreign_key: { on_delete: :nullify }, type: :uuid
      t.integer :kind, null: false
      t.integer :amount_cents, null: false
      t.string :currency, null: false, default: "HKD"
      t.integer :frequency, null: false
      t.integer :interval, null: false, default: 1
      t.integer :day_of_week
      t.integer :day_of_month
      t.integer :month_of_year
      t.date :start_on, null: false
      t.date :end_on
      t.datetime :next_run_at, null: false
      t.datetime :last_run_at
      t.integer :status, null: false, default: 0
      t.text :note
      t.timestamps
    end
    add_index :recurring_rules, [ :user_id, :status, :next_run_at ]

    create_table :recurring_occurrences, id: :uuid do |t|
      t.references :recurring_rule, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.date :occurred_on, null: false
      t.references :transaction, foreign_key: { on_delete: :nullify }, type: :uuid
      t.timestamps
    end
    add_index :recurring_occurrences, [ :recurring_rule_id, :occurred_on ], unique: true, name: "idx_recurring_occurrences_unique"
  end
end
