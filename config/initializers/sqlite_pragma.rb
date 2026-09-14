# Be sure to restart your server when you modify this file.
#
# Rails 8 sqlite adapter already defaults journal_mode=WAL and
# synchronous=NORMAL. Re-apply on every checkout so pooled / test
# reconnects keep busy_timeout=5000 as well.

Rails.application.config.after_initialize do
  ActiveRecord::Base.connection_handler.connection_pool_list(:all).each do |pool|
    pool.with_connection do |conn|
      next unless conn.adapter_name.match?(/sqlite/i)

      conn.execute("PRAGMA journal_mode=WAL;")
      conn.execute("PRAGMA busy_timeout=5000;")
      conn.execute("PRAGMA synchronous=NORMAL;")
    end
  rescue ActiveRecord::ConnectionNotEstablished, ActiveRecord::NoDatabaseError, ActiveRecord::StatementInvalid
    next
  end
end
