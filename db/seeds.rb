# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end

admin = User.find_or_initialize_by(username: "admin")
admin.password = ENV.fetch("ADMIN_PASSWORD", "admin1234") if admin.new_record?
admin.currency = "HKD"
admin.timezone = "Asia/Hong_Kong"
admin.save!

account = admin.accounts.find_or_create_by!(name: "示範戶口") do |record|
  record.kind = :bank
  record.currency = "HKD"
end
category = admin.categories.find_or_create_by!(name: "示範支出", kind: :expense) do |record|
  record.position = 99
end
unless admin.transactions.exists?(note: "Phase 7 example transaction")
  admin.transactions.create!(account: account, category: category, kind: :expense, amount_cents: 1_000, currency: "HKD", occurred_at: Time.zone.now, note: "Phase 7 example transaction", source: :manual)
end
