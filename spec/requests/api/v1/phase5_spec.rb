require "rails_helper"

RSpec.describe "Phase 5 receipt and AI APIs", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }
  let(:account) { user.accounts.first }

  def jpeg_upload
    file = Tempfile.new([ "receipt", ".jpg" ])
    file.binmode
    file.write("\xFF\xD8\xFF\xE0" + ("x" * 20))
    file.rewind
    Rack::Test::UploadedFile.new(file.path, "image/jpeg")
  end

  it "uploads with the LIHKG Origin header and returns a digest" do
    stub_request(:post, ENV.fetch("LIHKG_UPLOAD_URL", "https://img.eservice-hk.net/api.php?version=2")).with { |request| request.headers["Origin"] == "https://lihkg.com" }.to_return(status: 200, body: { url: "https://img.eservice-hk.net/a.jpg" }.to_json)
    post "/api/v1/receipts/upload", params: { file: jpeg_upload }, headers: headers
    expect(response).to have_http_status(:created)
    expect(json.dig("data", "url")).to end_with("a.jpg")
    expect(json.dig("data", "sha256")).to be_present
  end

  it "rejects a non-image upload" do
    file = Tempfile.new([ "receipt", ".exe" ])
    file.write("MZ" + ("x" * 20))
    file.rewind
    post "/api/v1/receipts/upload", params: { file: Rack::Test::UploadedFile.new(file.path, "application/octet-stream") }, headers: headers
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "caches a successful parse and rejects SSRF hosts" do
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    body = { choices: [ { message: { content: { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", confidence: 0.9 }.to_json } } ], usage: { prompt_tokens: 10, completion_tokens: 8 } }.to_json
    deepseek = stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: body)

    2.times { post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt.jpg" }, headers: headers, as: :json }
    expect(response).to have_http_status(:ok)
    expect(deepseek).to have_been_requested.once

    post "/api/v1/ai/parse", params: { image_url: "http://127.0.0.1/private" }, headers: headers, as: :json
    expect(response).to have_http_status(:bad_request)
  end

  it "ignores a cached parse produced with a stale prompt or category set" do
    image = "\xFF\xD8\xFF\xE0receipt".b
    sha = Digest::SHA256.hexdigest(image)
    stale = user.ai_import_logs.create!(image_urls: [ "https://img.eservice-hk.net/stale.jpg" ], image_sha256: sha, status: :success, parsed_json: { "amount_cents" => 1, "kind" => "expense", "category_hint" => nil })
    stub_request(:get, "https://img.eservice-hk.net/stale.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 4500, kind: "expense", occurred_at: "2026-02-21T15:45:00", category_hint: "飲食", confidence: 0.9 }
    deepseek = stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: { choices: [ { message: { content: parsed.to_json } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/stale.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(deepseek).to have_been_requested.once
    expect(json.dig("data", "id")).not_to eq(stale.id)
    expect(json.dig("data", "parsed", "amount_cents")).to eq(4500)
  end

  it "handles multibyte DeepSeek responses without encoding errors" do
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-cn.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", merchant_name: "茶餐廳", note: "午餐", confidence: 0.9 }
    body = { choices: [ { message: { content: parsed.to_json } } ], usage: { prompt_tokens: 10, completion_tokens: 8 } }.to_json.b
    stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: body)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-cn.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "parsed", "merchant_name")).to eq("茶餐廳")
  end

  it "matches the AI category hint against the user-defined categories" do
    food = user.categories.find_by!(name: "飲食", kind: :expense)
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-cat.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", category_hint: "飲食", confidence: 0.9 }
    deepseek = stub_request(:post, "https://api.deepseek.com/chat/completions")
      .with { |request| JSON.parse(request.body).dig("messages", 0, "content", 0, "text").include?("EXPENSE categories: [\"飲食\"") }
      .to_return(status: 200, body: { choices: [ { message: { content: parsed.to_json } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-cat.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "parsed", "category_hint")).to eq("飲食")
    expect(json.dig("data", "suggested_category_id")).to eq(food.id)
    expect(deepseek).to have_been_requested.once
  end

  it "normalizes the category hint to the stored category name" do
    groceries = user.categories.create!(name: "Groceries", kind: :expense)
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-case.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", category_hint: "groceries", confidence: 0.9 }
    stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: { choices: [ { message: { content: parsed.to_json } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-case.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "parsed", "category_hint")).to eq("Groceries")
    expect(json.dig("data", "suggested_category_id")).to eq(groceries.id)
  end

  it "recovers the parse when the model prefixes an extra json_object marker" do
    food = user.categories.find_by!(name: "飲食", kind: :expense)
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-prefix.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 4500, kind: "expense", occurred_at: "2026-02-21T15:45:00", category_hint: "飲食", confidence: 0.86 }
    content = %({"type": "json_object"}\n#{parsed.to_json})
    stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: { choices: [ { message: { content: content } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-prefix.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "status")).to eq("success")
    expect(json.dig("data", "parsed", "category_hint")).to eq("飲食")
    expect(json.dig("data", "parsed", "type")).to be_nil
    expect(json.dig("data", "suggested_category_id")).to eq(food.id)
  end

  it "forces an unmatched category hint to null" do
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-nomatch.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", category_hint: "餐飲", confidence: 0.9 }
    stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: { choices: [ { message: { content: parsed.to_json } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-nomatch.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "parsed", "category_hint")).to be_nil
    expect(json.dig("data", "suggested_category_id")).to be_nil
  end

  it "forces the hint to null when the kind does not match" do
    image = "\xFF\xD8\xFF\xE0receipt".b
    stub_request(:get, "https://img.eservice-hk.net/receipt-kind.jpg").to_return(status: 200, body: image, headers: { "Content-Type" => "image/jpeg" })
    parsed = { amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", category_hint: "薪水", confidence: 0.9 }
    stub_request(:post, "https://api.deepseek.com/chat/completions").to_return(status: 200, body: { choices: [ { message: { content: parsed.to_json } } ], usage: {} }.to_json)

    post "/api/v1/ai/parse", params: { image_url: "https://img.eservice-hk.net/receipt-kind.jpg" }, headers: headers, as: :json

    expect(response).to have_http_status(:ok)
    expect(json.dig("data", "parsed", "category_hint")).to be_nil
    expect(json.dig("data", "suggested_category_id")).to be_nil
  end

  it "confirms an AI parse into an AI transaction" do
    image_sha = Digest::SHA256.hexdigest("receipt")
    log = user.ai_import_logs.create!(image_urls: [ "https://img.eservice-hk.net/a.jpg" ], image_sha256: image_sha, status: :success, parsed_json: { amount_cents: 500, kind: "expense", occurred_at: Time.zone.now.iso8601 })
    post "/api/v1/ai/confirm", params: { ai_import_log_id: log.id, account_id: account.id, amount_cents: 500, kind: "expense", occurred_at: Time.zone.now.iso8601 }, headers: headers, as: :json
    expect(response).to have_http_status(:created)
    expect(json.dig("data", "source")).to eq("ai")
    expect(log.reload.transaction_id).to eq(json.dig("data", "id"))
  end
end
