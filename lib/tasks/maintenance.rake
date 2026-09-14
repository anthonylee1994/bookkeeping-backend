namespace :maintenance do
  desc "Remove expired idempotency keys"
  task cleanup: :environment do
    deleted = IdempotencyKey.where("created_at < ?", 24.hours.ago).delete_all
    puts "Deleted #{deleted} expired idempotency keys"
  end
end
