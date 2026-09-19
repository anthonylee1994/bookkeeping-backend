module QueryCounter
  # Counts SQL statements executed inside the block, ignoring schema queries and
  # query-cache hits, so specs can assert a request does not issue per-row queries.
  def count_queries(&block)
    count_sql_queries(nil, &block)
  end

  # Like #count_queries, but only counts statements whose SQL matches the pattern.
  # Useful for asserting associations are preloaded (one SELECT per table, not per row).
  def count_queries_matching(pattern, &block)
    count_sql_queries(pattern, &block)
  end

  private

  def count_sql_queries(pattern, &block)
    count = 0
    callback = lambda do |_name, _start, _finish, _id, payload|
      next if payload[:name] == "SCHEMA" || payload[:cached]
      count += 1 if pattern.nil? || payload[:sql].match?(pattern)
    end
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record", &block)
    count
  end
end

RSpec.configure do |config|
  config.include QueryCounter
end
