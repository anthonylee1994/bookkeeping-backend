require "marcel"
require "faraday/multipart"

class LihkgUploadService
  class Error < StandardError; end
  class InvalidFile < Error; end
  class UpstreamError < Error; end
  class CircuitOpen < Error; end

  ALLOWED_TYPES = %w[image/jpeg image/png image/gif image/webp].freeze

  def self.call(file)
    new(file).call
  end

  def initialize(file)
    @file = file
  end

  def call
    validate_file!
    light.run { upload! }
  rescue Stoplight::Error::RedLight => e
    raise CircuitOpen, e.message
  end

  private

  attr_reader :file

  def validate_file!
    raise InvalidFile, "file is required" unless file.respond_to?(:tempfile)
    raise InvalidFile, "file is too large" if file.tempfile.size > max_bytes

    @content_type = Marcel::MimeType.for(file.tempfile, name: file.original_filename)
    raise InvalidFile, "unsupported file type" unless ALLOWED_TYPES.include?(@content_type)
  end

  def upload!
    connection = Faraday.new do |f|
      f.request :multipart
      f.request :retry, max: 1, exceptions: [ Faraday::TimeoutError, Faraday::ConnectionFailed ]
      f.options.timeout = 10
      f.options.open_timeout = 10
    end
    response = connection.post(ENV.fetch("LIHKG_UPLOAD_URL", "https://img.eservice-hk.net/api.php?version=2")) do |request|
      request.headers["Origin"] = "https://lihkg.com"
      request.body = { "file" => Faraday::Multipart::FilePart.new(file.tempfile, @content_type, file.original_filename) }
    end
    raise UpstreamError, "LIHKG upload failed (#{response.status})" unless response.success?

    body = JSON.parse(response.body)
    url = body["url"] || body.dig("data", "url") || body.dig("result", "url")
    raise UpstreamError, "LIHKG response did not contain a URL" if url.blank?
    url
  rescue JSON::ParserError, Faraday::Error => e
    raise UpstreamError, e.message
  end

  def max_bytes
    Integer(ENV.fetch("MAX_UPLOAD_BYTES", 10.megabytes.to_s))
  end

  def light
    self.class.instance_variable_get(:@light) || self.class.instance_variable_set(
      :@light,
      Stoplight("lihkg-upload", threshold: Integer(ENV.fetch("LIHKG_CIRCUIT_FAILURES", 5)), cool_off_time: Integer(ENV.fetch("LIHKG_CIRCUIT_COOLDOWN", 60)))
    )
  end
end
