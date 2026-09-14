class DeepSeekService
  class Error < StandardError; end
  SCHEMA = {
    "type" => "object", "required" => %w[amount_cents kind occurred_at],
    "properties" => {
      "amount_cents" => { "type" => "integer", "minimum" => 1 },
      "kind" => { "enum" => %w[income expense] },
      "occurred_at" => { "type" => "string" },
      "merchant_name" => { "type" => [ "string", "null" ] },
      "category_hint" => { "type" => [ "string", "null" ] },
      "note" => { "type" => [ "string", "null" ] },
      "confidence" => { "type" => "number", "minimum" => 0, "maximum" => 1 }
    }
  }.freeze

  def self.call(image_base64:, content_type:)
    new(image_base64:, content_type:).call
  end

  def initialize(image_base64:, content_type:)
    @image_base64 = image_base64
    @content_type = content_type
  end

  def call
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    response = connection.post("/chat/completions", request_body.to_json)
    raise Error, "DeepSeek returned #{response.status}" unless response.success?

    raw = JSON.parse(response.body)
    content = raw.dig("choices", 0, "message", "content").to_s
    parsed = JSON.parse(content)
    JSON::Validator.validate!(SCHEMA, parsed)
    { parsed: parsed, raw_response: response.body, tokens_in: raw.dig("usage", "prompt_tokens"), tokens_out: raw.dig("usage", "completion_tokens"), latency_ms: elapsed_ms(started), status: :success }
  rescue JSON::ParserError, JSON::Schema::ValidationError, JSON::Schema::JsonParseError => e
    { parsed: (defined?(parsed) ? parsed : nil), raw_response: (response&.body rescue nil), error_message: e.message, latency_ms: elapsed_ms(started), status: :partial }
  rescue Faraday::Error, Error => e
    raise e
  end

  private

  def connection
    Faraday.new(url: ENV.fetch("DEEPSEEK_BASE_URL", "https://api.deepseek.com")) do |f|
      f.request :retry, max: 1
      f.headers["Authorization"] = "Bearer #{ENV.fetch("DEEPSEEK_API_KEY")}"
      f.headers["Content-Type"] = "application/json"
      f.options.timeout = 30
    end
  end

  def request_body
    { model: ENV.fetch("DEEPSEEK_MODEL", "deepseek-flash"), messages: [ { role: "user", content: [ { type: "text", text: "Extract transaction data as JSON. Return only valid JSON with amount_cents, kind, occurred_at, merchant_name, category_hint, note, confidence." }, { type: "image_url", image_url: { url: "data:#{@content_type};base64,#{@image_base64}" } } ] } ], response_format: { type: "json_object" } }
  end

  def elapsed_ms(started)
    ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
  end
end
