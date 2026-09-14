class CreateAccountsCategoriesAndMerchants < ActiveRecord::Migration[8.1]
  def change
    create_table :accounts, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.string :name, null: false
      t.integer :kind, null: false
      t.string :icon
      t.string :color
      t.integer :initial_balance_cents, null: false, default: 0
      t.string :currency, null: false, default: "HKD"
      t.timestamps
    end
    add_index :accounts, [ :user_id, :name ], unique: true

    create_table :categories, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.string :name, null: false
      t.integer :kind, null: false
      t.string :icon
      t.string :color
      t.integer :position, null: false, default: 0
      t.timestamps
    end
    add_index :categories, [ :user_id, :kind, :name ], unique: true

    create_table :merchants, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.string :name, null: false
      t.references :default_category, foreign_key: { to_table: :categories, on_delete: :nullify }, type: :uuid
      t.integer :usage_count, null: false, default: 0
      t.timestamps
    end
    add_index :merchants, [ :user_id, :name ], unique: true
  end
end
