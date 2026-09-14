require "rails_helper"

RSpec.describe "API docs", type: :request do
  it "serves the OpenAPI documentation UI" do
    get "/api-docs"
    expect([ 200, 301, 302 ]).to include(response.status)
  end

  it "serves the OpenAPI definition" do
    get "/api-docs/v1/swagger.yaml"
    expect(response).to have_http_status(:ok)
    expect(response.body).to include("Bookkeeping API")
  end
end
