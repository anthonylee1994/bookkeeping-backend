class CreateTransactionsAndIdempotencyKeys < ActiveRecord::Migration[8.1]
  def change
    create_table :transactions, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.references :account, null: false, foreign_key: { on_delete: :restrict }, type: :uuid
      t.references :category, foreign_key: { on_delete: :nullify }, type: :uuid
      t.references :merchant, foreign_key: { on_delete: :nullify }, type: :uuid
      t.integer :kind, null: false
      t.integer :amount_cents, null: false
      t.string :currency, null: false, default: "HKD"
      t.datetime :occurred_at, null: false
      t.text :note
      t.string :payment_method
      t.json :image_urls, null: false, default: []
      t.integer :source, null: false, default: 0
      t.references :refund_of, foreign_key: { to_table: :transactions, on_delete: :cascade }, type: :uuid
      t.references :transfer_account, foreign_key: { to_table: :accounts, on_delete: :restrict }, type: :uuid
      t.string :idempotency_key
      t.timestamps
    end
    add_index :transactions, [ :user_id, :occurred_at ]
    add_index :transactions, [ :user_id, :kind, :occurred_at ]

    create_table :idempotency_keys, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.string :key, null: false
      t.string :request_hash, null: false
      t.integer :response_status
      t.text :response_body
      t.timestamps
    end
    add_index :idempotency_keys, [ :user_id, :key ], unique: true
    add_index :idempotency_keys, :created_at
  end
end
