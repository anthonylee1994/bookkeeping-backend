class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users, id: :uuid do |t|
      t.string :username, null: false
      t.string :password_digest, null: false
      t.string :timezone, null: false, default: "Asia/Hong_Kong"
      t.string :currency, null: false, default: "HKD"
      t.timestamps
    end

    add_index :users, :username, unique: true
  end
end
