class CreateAiImportLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_import_logs, id: :uuid do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.json :image_urls, null: false, default: []
      t.string :image_sha256, null: false
      t.string :provider, null: false, default: "deepseek"
      t.string :model, null: false, default: "deepseek-flash"
      t.integer :tokens_in
      t.integer :tokens_out
      t.integer :latency_ms
      t.integer :status, null: false, default: 0
      t.text :raw_response
      t.json :parsed_json
      t.text :error_message
      t.references :transaction, foreign_key: { on_delete: :nullify }, type: :uuid
      t.string :idempotency_key
      t.timestamps
    end
    add_index :ai_import_logs, :image_sha256
    add_index :ai_import_logs, [ :user_id, :image_sha256, :created_at ]
  end
end
