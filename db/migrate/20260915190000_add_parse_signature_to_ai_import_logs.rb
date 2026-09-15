class AddParseSignatureToAiImportLogs < ActiveRecord::Migration[8.1]
  def change
    add_column :ai_import_logs, :parse_signature, :string
    add_index :ai_import_logs, [ :user_id, :image_sha256, :parse_signature ], name: "idx_ai_import_logs_cache_lookup"
  end
end
