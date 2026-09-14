# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_09_14_160000) do
  create_table "accounts", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.string "color"
    t.datetime "created_at", null: false
    t.string "currency", default: "HKD", null: false
    t.string "icon"
    t.integer "initial_balance_cents", default: 0, null: false
    t.integer "kind", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["user_id", "name"], name: "index_accounts_on_user_id_and_name", unique: true
    t.index ["user_id"], name: "index_accounts_on_user_id"
  end

  create_table "ai_import_logs", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "error_message"
    t.string "idempotency_key"
    t.string "image_sha256", null: false
    t.json "image_urls", default: [], null: false
    t.integer "latency_ms"
    t.string "model", default: "deepseek-flash", null: false
    t.json "parsed_json"
    t.string "provider", default: "deepseek", null: false
    t.text "raw_response"
    t.integer "status", default: 0, null: false
    t.integer "tokens_in"
    t.integer "tokens_out"
    t.string "transaction_id", limit: 36
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["image_sha256"], name: "index_ai_import_logs_on_image_sha256"
    t.index ["transaction_id"], name: "index_ai_import_logs_on_transaction_id"
    t.index ["user_id", "image_sha256", "created_at"], name: "idx_on_user_id_image_sha256_created_at_a5f17f3d34"
    t.index ["user_id"], name: "index_ai_import_logs_on_user_id"
  end

  create_table "categories", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.string "color"
    t.datetime "created_at", null: false
    t.string "icon"
    t.integer "kind", null: false
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["user_id", "kind", "name"], name: "index_categories_on_user_id_and_kind_and_name", unique: true
    t.index ["user_id"], name: "index_categories_on_user_id"
  end

  create_table "idempotency_keys", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "key", null: false
    t.string "request_hash", null: false
    t.text "response_body"
    t.integer "response_status"
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["created_at"], name: "index_idempotency_keys_on_created_at"
    t.index ["user_id", "key"], name: "index_idempotency_keys_on_user_id_and_key", unique: true
    t.index ["user_id"], name: "index_idempotency_keys_on_user_id"
  end

  create_table "merchants", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "default_category_id", limit: 36
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.integer "usage_count", default: 0, null: false
    t.string "user_id", limit: 36, null: false
    t.index ["default_category_id"], name: "index_merchants_on_default_category_id"
    t.index ["user_id", "name"], name: "index_merchants_on_user_id_and_name", unique: true
    t.index ["user_id"], name: "index_merchants_on_user_id"
  end

  create_table "recurring_occurrences", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.date "occurred_on", null: false
    t.string "recurring_rule_id", limit: 36, null: false
    t.string "transaction_id", limit: 36
    t.datetime "updated_at", null: false
    t.index ["recurring_rule_id", "occurred_on"], name: "idx_recurring_occurrences_unique", unique: true
    t.index ["recurring_rule_id"], name: "index_recurring_occurrences_on_recurring_rule_id"
    t.index ["transaction_id"], name: "index_recurring_occurrences_on_transaction_id"
  end

  create_table "recurring_rules", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.string "account_id", limit: 36, null: false
    t.integer "amount_cents", null: false
    t.string "category_id", limit: 36
    t.datetime "created_at", null: false
    t.string "currency", default: "HKD", null: false
    t.integer "day_of_month"
    t.integer "day_of_week"
    t.date "end_on"
    t.integer "frequency", null: false
    t.integer "interval", default: 1, null: false
    t.integer "kind", null: false
    t.datetime "last_run_at"
    t.string "merchant_id", limit: 36
    t.integer "month_of_year"
    t.datetime "next_run_at", null: false
    t.text "note"
    t.date "start_on", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["account_id"], name: "index_recurring_rules_on_account_id"
    t.index ["category_id"], name: "index_recurring_rules_on_category_id"
    t.index ["merchant_id"], name: "index_recurring_rules_on_merchant_id"
    t.index ["user_id", "status", "next_run_at"], name: "index_recurring_rules_on_user_id_and_status_and_next_run_at"
    t.index ["user_id"], name: "index_recurring_rules_on_user_id"
  end

  create_table "transactions", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.string "account_id", limit: 36, null: false
    t.integer "amount_cents", null: false
    t.string "category_id", limit: 36
    t.datetime "created_at", null: false
    t.string "currency", default: "HKD", null: false
    t.string "idempotency_key"
    t.json "image_urls", default: [], null: false
    t.integer "kind", null: false
    t.string "merchant_id", limit: 36
    t.text "note"
    t.datetime "occurred_at", null: false
    t.string "payment_method"
    t.string "refund_of_id", limit: 36
    t.integer "source", default: 0, null: false
    t.string "transfer_account_id", limit: 36
    t.datetime "updated_at", null: false
    t.string "user_id", limit: 36, null: false
    t.index ["account_id"], name: "index_transactions_on_account_id"
    t.index ["category_id"], name: "index_transactions_on_category_id"
    t.index ["merchant_id"], name: "index_transactions_on_merchant_id"
    t.index ["refund_of_id"], name: "index_transactions_on_refund_of_id"
    t.index ["transfer_account_id"], name: "index_transactions_on_transfer_account_id"
    t.index ["user_id", "kind", "occurred_at"], name: "index_transactions_on_user_id_and_kind_and_occurred_at"
    t.index ["user_id", "occurred_at"], name: "index_transactions_on_user_id_and_occurred_at"
    t.index ["user_id"], name: "index_transactions_on_user_id"
  end

  create_table "users", id: { type: :string, limit: 36 }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "currency", default: "HKD", null: false
    t.string "password_digest", null: false
    t.string "timezone", default: "Asia/Hong_Kong", null: false
    t.datetime "updated_at", null: false
    t.string "username", null: false
    t.index ["username"], name: "index_users_on_username", unique: true
  end

  add_foreign_key "accounts", "users", on_delete: :cascade
  add_foreign_key "ai_import_logs", "transactions", on_delete: :nullify
  add_foreign_key "ai_import_logs", "users", on_delete: :cascade
  add_foreign_key "categories", "users", on_delete: :cascade
  add_foreign_key "idempotency_keys", "users", on_delete: :cascade
  add_foreign_key "merchants", "categories", column: "default_category_id", on_delete: :nullify
  add_foreign_key "merchants", "users", on_delete: :cascade
  add_foreign_key "recurring_occurrences", "recurring_rules", on_delete: :cascade
  add_foreign_key "recurring_occurrences", "transactions", on_delete: :nullify
  add_foreign_key "recurring_rules", "accounts", on_delete: :restrict
  add_foreign_key "recurring_rules", "categories", on_delete: :nullify
  add_foreign_key "recurring_rules", "merchants", on_delete: :nullify
  add_foreign_key "recurring_rules", "users", on_delete: :cascade
  add_foreign_key "transactions", "accounts", column: "transfer_account_id", on_delete: :restrict
  add_foreign_key "transactions", "accounts", on_delete: :restrict
  add_foreign_key "transactions", "categories", on_delete: :nullify
  add_foreign_key "transactions", "merchants", on_delete: :nullify
  add_foreign_key "transactions", "transactions", column: "refund_of_id", on_delete: :cascade
  add_foreign_key "transactions", "users", on_delete: :cascade
end
