# SQLite has no native UUID type. Map :uuid to varchar(36) so
# `create_table ..., id: :uuid` and `t.references ..., type: :uuid` work.

module BookkeepingBackend
  module SqliteUuid
    def native_database_types
      super.merge(uuid: { name: "varchar", limit: 36 })
    end
  end
end

ActiveSupport.on_load(:active_record_sqlite3adapter) do
  prepend BookkeepingBackend::SqliteUuid
end
