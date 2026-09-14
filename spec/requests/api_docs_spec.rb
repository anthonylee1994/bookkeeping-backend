require "rails_helper"

RSpec.describe "API docs", type: :request do
  it "serves the OpenAPI documentation UI" do
    get "/api-docs"
    expect([ 200, 301, 302 ]).to include(response.status)
  end
end
