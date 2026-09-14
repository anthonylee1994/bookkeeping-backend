require "rails_helper"

RSpec.describe "Categories", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }

  it "creates the expected defaults without an income category named 收入" do
    get "/api/v1/categories", headers: headers

    expect(response).to have_http_status(:ok)
    categories = json.fetch("data")
    expect(categories.length).to eq(13)
    expect(categories.select { |category| category["kind"] == "expense" }.pluck("name"))
      .to eq(%w[飲食 交通 娛樂 購物 醫療 住屋 水電 其他支出])
    expect(categories.select { |category| category["kind"] == "income" }.pluck("name"))
      .to eq(%w[薪水 獎金 投資 兼職 其他收入])
    expect(categories.pluck("name")).not_to include("收入")
  end

  it "filters, creates, updates, and deletes categories" do
    post "/api/v1/categories", params: { name: "寵物", kind: "expense", position: 20 }, headers: headers, as: :json
    expect(response).to have_http_status(:created)
    category_id = json.dig("data", "id")

    patch "/api/v1/categories/#{category_id}", params: { name: "毛孩" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "name")).to eq("毛孩")

    get "/api/v1/categories", params: { kind: "expense" }, headers: headers
    expect(json.fetch("data").pluck("kind").uniq).to eq([ "expense" ])

    delete "/api/v1/categories/#{category_id}", headers: headers
    expect(response).to have_http_status(:no_content)
  end

  it "returns 404 for another user's category id" do
    category = create(:category)

    delete "/api/v1/categories/#{category.id}", headers: headers

    expect(response).to have_http_status(:not_found)
    expect(Category.where(id: category.id)).to exist
  end
end
