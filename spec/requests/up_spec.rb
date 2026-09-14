require "rails_helper"

RSpec.describe "GET /up", type: :request do
  it "returns 200" do
    get "/up"
    expect(response).to have_http_status(:ok)
  end
end
