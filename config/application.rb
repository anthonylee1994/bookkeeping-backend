require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_view/railtie"

Bundler.require(*Rails.groups)

module BookkeepingBackend
  class Application < Rails::Application
    config.load_defaults 8.1

    config.autoload_lib(ignore: %w[assets tasks])

    config.api_only = true
    config.i18n.default_locale = :"zh-TW"

    config.time_zone = "Asia/Hong_Kong"
    config.active_record.default_timezone = :local

    # RequestId is already in the API stack. Insert Rack::Attack after it so
    # throttled responses can include action_dispatch.request_id.
    config.middleware.insert_after ActionDispatch::RequestId, Rack::Attack

    config.generators do |g|
      g.test_framework :rspec
      g.fixture_replacement :factory_bot, dir: "spec/factories"
      g.orm :active_record, primary_key_type: :uuid
    end
  end
end
