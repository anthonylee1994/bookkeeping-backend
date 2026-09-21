class RecurringCatchUp
  def self.call(user:, now: Time.zone.now)
    new(user, now).call
  end

  def initialize(user, now)
    @user = user
    @now = now.in_time_zone("Asia/Hong_Kong")
  end

  def call
    @user.recurring_rules.includes(:account, :category, :merchant).where(status: :active).where("next_run_at <= ?", @now).find_each do |rule|
      process_rule(rule)
    end
  end

  private

  def process_rule(rule)
    due = []
    cursor = rule.next_run_at.in_time_zone("Asia/Hong_Kong")
    while cursor <= @now
      break if rule.end_on && cursor.to_date > rule.end_on
      due << cursor
      cursor = RecurringRuleCalculator.next_occurrence(from: cursor, rule: rule)
      break if backfill_enabled? && cursor.to_date < (@now.to_date - backfill_limit.days)
    end
    return if due.empty?

    if backfill_enabled?
      cutoff = @now.to_date - backfill_limit.days
      skipped = due.count { |run_at| run_at.to_date < cutoff }
      Rails.logger.warn("recurring backfill limit reached rule_id=#{rule.id} skipped=#{skipped}") if skipped.positive?
      due = due.select { |run_at| run_at.to_date >= cutoff }
    end
    materialize_from = backfill_enabled? ? due : [ due.last ]
    due.each { |run_at| record_occurrence(rule, run_at, materialize_from.include?(run_at)) }
    rule.update!(last_run_at: @now, next_run_at: cursor)
    rule.update!(status: :ended) if rule.end_on && cursor.to_date > rule.end_on
  end

  def record_occurrence(rule, run_at, materialize)
    occurrence = rule.recurring_occurrences.create!(occurred_on: run_at.to_date)
    return unless materialize && occurrence.transaction_id.nil?
    occurrence.transaction_record = Transaction.create!(
      user: @user, account: rule.account, category: rule.category, merchant: rule.merchant,
      kind: rule.kind, amount_cents: rule.amount_cents, currency: rule.currency,
      occurred_at: run_at, note: rule.note, source: :recurring
    )
    occurrence.save!
  rescue ActiveRecord::RecordNotUnique
    # A concurrent request already materialized this occurrence.
  end

  def backfill_enabled?
    ActiveModel::Type::Boolean.new.cast(ENV.fetch("RECURRING_BACKFILL_ENABLED", "false"))
  end

  def backfill_limit
    [ ENV.fetch("RECURRING_BACKFILL_MAX_DAYS", "90").to_i, 1 ].max
  end
end
