# This file was generated for Phase 0. Keep it light; Rails-specific setup
# lives in rails_helper.rb.
require "simplecov"
SimpleCov.start "rails" do
  enable_coverage :branch
  minimum_coverage 80
  skip "/spec/"
end
RSpec.configure do |config|
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups
  config.filter_run_when_matching :focus
  config.example_status_persistence_file_path = "spec/examples.txt"
  config.disable_monkey_patching!
  config.order = :random
  Kernel.srand config.seed
end
