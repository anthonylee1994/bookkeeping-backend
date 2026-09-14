VCR.configure do |c|
  c.cassette_library_dir = "spec/vcr_cassettes"
  c.hook_into :webmock
  c.configure_rspec_metadata!
  c.ignore_localhost = true
  c.filter_sensitive_data("<DEEPSEEK_API_KEY>") { ENV["DEEPSEEK_API_KEY"] }
end
