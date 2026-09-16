require "rails_helper"

RSpec.describe "Merchants", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }

  it "returns at most ten matching merchants ordered by usage" do
    11.times { |index| create(:merchant, user: user, name: "Coffee #{index}", usage_count: index) }
    create(:merchant, user: user, name: "Tea", usage_count: 100)
    create(:merchant, name: "Coffee outsider", usage_count: 200)

    get "/api/v1/merchants", params: { q: "coffee" }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch("data").length).to eq(10)
    expect(json.fetch("data").first["name"]).to eq("Coffee 10")
    expect(json.fetch("data").pluck("name")).not_to include("Coffee outsider", "Coffee 0")
  end

  it "returns every merchant when no search query is given" do
    12.times { |index| create(:merchant, user: user, name: "Merchant #{index}", usage_count: index) }
    create(:merchant, name: "Outsider")

    get "/api/v1/merchants", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch("data").length).to eq(12)
    expect(json.fetch("data").pluck("name")).not_to include("Outsider")
  end

  it "creates a merchant and nullifies its default category when the category is deleted" do
    category = user.categories.expense.first
    post "/api/v1/merchants", params: { name: "Cafe", default_category_id: category.id }, headers: headers, as: :json
    expect(response).to have_http_status(:created)
    merchant_id = json.dig("data", "id")

    delete "/api/v1/categories/#{category.id}", headers: headers

    expect(response).to have_http_status(:no_content)
    expect(Merchant.find(merchant_id).default_category_id).to be_nil
  end

  it "does not allow another user's category as the default" do
    category = create(:category)

    post "/api/v1/merchants", params: { name: "Cafe", default_category_id: category.id }, headers: headers, as: :json

    expect(response).to have_http_status(:unprocessable_content)
  end

  it "updates a merchant's name and default category" do
    merchant = create(:merchant, user: user, name: "Cafe")
    category = user.categories.expense.first

    patch "/api/v1/merchants/#{merchant.id}", params: { name: "Coffee Shop", default_category_id: category.id }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "name")).to eq("Coffee Shop")
    expect(json.dig("data", "default_category_id")).to eq(category.id)
    expect(merchant.reload.default_category_id).to eq(category.id)
  end

  it "rejects an update that points at another user's category" do
    merchant = create(:merchant, user: user)
    category = create(:category)

    patch "/api/v1/merchants/#{merchant.id}", params: { default_category_id: category.id }, headers: headers, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(merchant.reload.default_category_id).to be_nil
  end

  it "does not update another user's merchant" do
    merchant = create(:merchant)

    patch "/api/v1/merchants/#{merchant.id}", params: { name: "Hacked" }, headers: headers, as: :json

    expect(response).to have_http_status(:not_found)
    expect(merchant.reload.name).not_to eq("Hacked")
  end
end
