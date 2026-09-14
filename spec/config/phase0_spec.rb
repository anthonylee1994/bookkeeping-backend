require "rails_helper"

RSpec.describe "Phase 0 configuration" do
  it "uses Asia/Hong_Kong as the app timezone" do
    expect(Time.zone.name).to eq("Asia/Hong_Kong")
    expect(ActiveRecord.default_timezone).to eq(:local)
    expect(ENV["TZ"]).to eq("Asia/Hong_Kong")
  end

  it "caps pagy at 100 items per page" do
    expect(Pagy::DEFAULT[:max_per_page]).to eq(100)
    expect(Pagy::DEFAULT[:limit_max]).to eq(100)
  end

  it "configures primary and cache sqlite databases under storage/" do
    configs = ActiveRecord::Base.configurations.configs_for(env_name: Rails.env)
    names = configs.map(&:name)
    expect(names).to include("primary", "cache")
    configs.each do |config|
      expect(config.database).to match(%r{\Astorage/})
    end
  end

  it "inserts Rack::Attack after ActionDispatch::RequestId" do
    stack = Rails.application.middleware
    request_id_index = stack.find_index(ActionDispatch::RequestId)
    attack_index = stack.find_index(Rack::Attack)

    expect(request_id_index).to be_an(Integer)
    expect(attack_index).to be_an(Integer)
    expect(attack_index).to be > request_id_index
  end

  it "enables WAL and busy_timeout on the primary sqlite connection" do
    conn = ActiveRecord::Base.connection
    journal = pragma_value(conn, "journal_mode")
    timeout = pragma_value(conn, "busy_timeout")

    expect(journal.to_s.downcase).to eq("wal")
    expect(timeout.to_i).to eq(5000)
  end

  def pragma_value(conn, name)
    result = conn.execute("PRAGMA #{name};")
    row = result.first
    return if row.nil?

    row[name] || row[name.to_sym] || row.values.first
  end
end
