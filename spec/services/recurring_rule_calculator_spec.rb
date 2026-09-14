require "rails_helper"

RSpec.describe RecurringRuleCalculator do
  it "clamps monthly day 31 to February's last day" do
    rule = build(:recurring_rule, frequency: :monthly, day_of_month: 31, interval: 1)
    result = described_class.next_occurrence(from: Time.zone.local(2026, 1, 31, 9), rule: rule)
    expect(result.to_date).to eq(Date.new(2026, 2, 28))
  end

  it "supports interval daily and yearly rules" do
    daily = build(:recurring_rule, frequency: :daily, interval: 2)
    yearly = build(:recurring_rule, frequency: :yearly, interval: 1, month_of_year: 2, day_of_month: 29)
    expect(described_class.next_occurrence(from: Time.zone.local(2026, 1, 1), rule: daily).to_date).to eq(Date.new(2026, 1, 3))
    expect(described_class.next_occurrence(from: Time.zone.local(2026, 2, 28), rule: yearly).to_date).to eq(Date.new(2027, 2, 28))
  end
end
