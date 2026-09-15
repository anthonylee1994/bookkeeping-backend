class DeepSeekService
  class Error < StandardError; end
  # 每次改動 prompt／解析邏輯都要 bump，等舊 cache 自動失效。
  PROMPT_VERSION = "v2".freeze
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

  def self.call(image_base64:, content_type:, categories: [])
    new(image_base64:, content_type:, categories:).call
  end

  def initialize(image_base64:, content_type:, categories: [])
    @image_base64 = image_base64
    @content_type = content_type
    @categories = Array(categories)
  end

  def call
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    body = nil
    response = connection.post("/chat/completions", request_body.to_json)
    raise Error, "DeepSeek returned #{response.status}" unless response.success?

    body = utf8(response.body)
    raw = JSON.parse(body)
    content = raw.dig("choices", 0, "message", "content").to_s
    parsed = extract_json_object(content)
    raise JSON::ParserError, "DeepSeek response did not contain a JSON object" if parsed.nil?

    # Model 有時會將 response_format 嘅 type 都塞埋入 JSON，清走佢。
    parsed = parsed.except("type") if parsed["type"] == "json_object"
    JSON::Validator.validate!(SCHEMA, parsed)
    { parsed: parsed, raw_response: body, tokens_in: raw.dig("usage", "prompt_tokens"), tokens_out: raw.dig("usage", "completion_tokens"), latency_ms: elapsed_ms(started), status: :success }
  rescue JSON::ParserError, JSON::Schema::ValidationError, JSON::Schema::JsonParseError => e
    { parsed: (defined?(parsed) ? parsed : nil), raw_response: raw_response_for(response, body), error_message: e.message, latency_ms: elapsed_ms(started), status: :partial }
  rescue Faraday::Error, Error => e
    raise e
  end

  private

  # Model 偶爾會喺真正嘅 JSON 前面多印一個 `{"type":"json_object"}`，或者用 code fence
  # 包住，直接 JSON.parse 會爆。呢度用括號平衡掃描，揀返最有 transaction 特徵嘅 object。
  def extract_json_object(content)
    candidates = extract_json_objects(content)
    candidates.reverse.find { |object| object.is_a?(Hash) && object.key?("amount_cents") } || candidates.last
  end

  def extract_json_objects(text)
    objects = []
    depth = 0
    start = nil
    in_string = false
    escaped = false

    text.each_char.with_index do |char, index|
      if in_string
        if escaped
          escaped = false
        elsif char == "\\"
          escaped = true
        elsif char == '"'
          in_string = false
        end
        next
      end

      case char
      when '"'
        in_string = true if depth.positive?
      when "{"
        start = index if depth.zero?
        depth += 1
      when "}"
        next if depth.zero?

        depth -= 1
        if depth.zero? && start
          objects << parse_json_object(text[start..index])
          start = nil
        end
      end
    end

    objects.compact
  end

  def parse_json_object(raw)
    JSON.parse(raw)
  rescue JSON::ParserError
    nil
  end

  # Faraday 回傳嘅 body 係 ASCII-8BIT，直接寫入 UTF-8 text column 會爆 UndefinedConversionError。
  def utf8(raw)
    string = raw.to_s.dup.force_encoding(Encoding::UTF_8)
    string.valid_encoding? ? string : string.scrub
  end

  def raw_response_for(response, body)
    return body if body
    response&.body && utf8(response.body)
  rescue StandardError
    nil
  end

  def connection
    Faraday.new(url: ENV.fetch("DEEPSEEK_BASE_URL", "https://api.deepseek.com")) do |f|
      f.request :retry, max: 1
      f.headers["Authorization"] = "Bearer #{ENV.fetch("DEEPSEEK_API_KEY")}"
      f.headers["Content-Type"] = "application/json"
      f.options.timeout = 30
    end
  end

  def request_body
    { model: ENV.fetch("DEEPSEEK_MODEL", "deepseek-flash"), messages: [ { role: "user", content: [ { type: "text", text: prompt }, { type: "image_url", image_url: { url: "data:#{@content_type};base64,#{@image_base64}" } } ] } ], response_format: { type: "json_object" } }
  end

  def prompt
    <<~PROMPT
      You extract a single transaction from a receipt image and reply with JSON only.
      The JSON must have exactly these keys:
      - amount_cents: integer in cents (> 0)
      - kind: "income" or "expense"
      - occurred_at: ISO8601 date-time string
      - merchant_name: string or null
      - category_hint: string or null
      - note: string or null
      - confidence: number between 0 and 1

      #{category_instructions}
    PROMPT
  end

  # 將用戶自己定義嘅分類餵入 prompt。分開 income／expense 兩組，並要求逐字 copy，
  # 令 model 唔會翻譯、改寫或者自己作一個分類名。
  def category_instructions
    return "There are no user-defined categories. Always set category_hint to null." if @categories.empty?

    <<~PROMPT
      Category rules (follow strictly):
      - Decide kind first, then set category_hint to one of the exact strings from that kind's list.
      - Copy the chosen name character-for-character. Do NOT translate it, shorten it, add "(expense)"/"(income)", or invent a new name.
      - If kind is "expense" only use the EXPENSE list; if kind is "income" only use the INCOME list.
      - If no category fits, set category_hint to null. Returning null is always allowed and preferred over guessing.

      EXPENSE categories: #{category_names("expense")}
      INCOME categories: #{category_names("income")}
    PROMPT
  end

  def category_names(kind)
    names = @categories.select { |category| category.kind == kind }.map(&:name)
    names.empty? ? "[]" : JSON.generate(names)
  end

  def elapsed_ms(started)
    ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
  end
end
