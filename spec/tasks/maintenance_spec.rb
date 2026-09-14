require "rails_helper"
require "rake"
Rails.application.load_tasks

RSpec.describe "maintenance:cleanup" do
  it "deletes idempotency keys older than 24 hours" do
    old = create(:idempotency_key, created_at: 25.hours.ago)
    recent = create(:idempotency_key, created_at: 1.hour.ago)

    expect { Rake::Task["maintenance:cleanup"].invoke }.to change(IdempotencyKey, :count).by(-1)
    expect { old.reload }.to raise_error(ActiveRecord::RecordNotFound)
    expect(recent.reload).to be_present
  ensure
    Rake::Task["maintenance:cleanup"].reenable
  end
end
