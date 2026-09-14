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

ActiveRecord::Schema[8.1].define(version: 2026_09_14_140000) do
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
  add_foreign_key "categories", "users", on_delete: :cascade
  add_foreign_key "idempotency_keys", "users", on_delete: :cascade
  add_foreign_key "merchants", "categories", column: "default_category_id", on_delete: :nullify
  add_foreign_key "merchants", "users", on_delete: :cascade
  add_foreign_key "transactions", "accounts", column: "transfer_account_id", on_delete: :restrict
  add_foreign_key "transactions", "accounts", on_delete: :restrict
  add_foreign_key "transactions", "categories", on_delete: :nullify
  add_foreign_key "transactions", "merchants", on_delete: :nullify
  add_foreign_key "transactions", "transactions", column: "refund_of_id", on_delete: :cascade
  add_foreign_key "transactions", "users", on_delete: :cascade
end
