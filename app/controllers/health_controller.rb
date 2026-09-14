class HealthController < ActionController::API
  def show
    checks = {
      db: check_db,
      deepseek: check_deepseek,
      lihkg: check_lihkg
    }
    render_check(checks)
  end

  def db
    render_check(db: check_db)
  end

  def deepseek
    render_check(deepseek: check_deepseek)
  end

  def lihkg
    render_check(lihkg: check_lihkg)
  end

  private

  def render_check(checks)
    healthy = checks.values.all? { |check| check[:status] == "ok" }
    render json: { status: healthy ? "ok" : "error", checks: checks }, status: healthy ? :ok : :service_unavailable
  end

  def check_db
    result = ActiveRecord::Base.connection.select_value("PRAGMA journal_mode")
    wal = result.to_s.downcase == "wal"
    { status: wal ? "ok" : "error", wal: wal }
  rescue StandardError => e
    Rails.logger.warn("health db check failed: #{e.class}: #{e.message}")
    { status: "error", wal: false }
  end

  def check_deepseek
    response = upstream_connection(ENV.fetch("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      "Bearer #{ENV.fetch("DEEPSEEK_API_KEY")}").get("/models")
    { status: response.success? ? "ok" : "error", code: response.status }
  rescue KeyError, Faraday::Error => e
    Rails.logger.warn("health deepseek check failed: #{e.class}: #{e.message}")
    { status: "error" }
  end

  def check_lihkg
    url = ENV.fetch("LIHKG_HEALTHCHECK_URL", ENV.fetch("LIHKG_UPLOAD_URL", "https://img.eservice-hk.net/api.php?version=2"))
    response = upstream_connection(url).get
    { status: response.success? ? "ok" : "error", code: response.status }
  rescue Faraday::Error => e
    Rails.logger.warn("health lihkg check failed: #{e.class}: #{e.message}")
    { status: "error" }
  end

  def upstream_connection(url, authorization = nil)
    Faraday.new(url:) do |faraday|
      faraday.options.timeout = 5
      faraday.options.open_timeout = 3
      faraday.headers["Authorization"] = authorization if authorization
      faraday.headers["Origin"] = "https://lihkg.com" if url.include?("img.eservice-hk.net")
    end
  end
end
