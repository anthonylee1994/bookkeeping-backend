class RecurringRuleCalculator
  class << self
    def next_occurrence(from:, rule:)
      time = from.in_time_zone("Asia/Hong_Kong")
      case rule.frequency.to_sym
      when :daily then time + rule.interval.days
      when :weekly then next_weekly(time, rule)
      when :monthly then next_monthly(time, rule)
      when :yearly then next_yearly(time, rule)
      end
    end

    private

    def next_weekly(time, rule)
      target = rule.day_of_week.nil? ? time.wday : rule.day_of_week
      candidate = time + rule.interval.weeks
      delta = (target - candidate.wday) % 7
      candidate + delta.days
    end

    def next_monthly(time, rule)
      month = time.to_date >> rule.interval
      day = [ rule.day_of_month || time.day, month.end_of_month.day ].min
      Time.zone.local(month.year, month.month, day, time.hour, time.min, time.sec)
    end

    def next_yearly(time, rule)
      date = time.to_date
      year = date.year + rule.interval
      month = rule.month_of_year || date.month
      day = [ rule.day_of_month || date.day, Date.new(year, month, -1).day ].min
      Time.zone.local(year, month, day, time.hour, time.min, time.sec)
    end
  end
end
