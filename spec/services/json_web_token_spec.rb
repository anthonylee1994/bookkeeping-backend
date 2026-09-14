require "rails_helper"

RSpec.describe JsonWebToken do
  let(:user_id) { "7c9e6679-7425-40de-944b-e07fc1f90ae7" }
  let(:secret) { ENV.fetch("JWT_SECRET") }

  describe ".encode" do
    it "signs user_id and iat with HS256 and omits exp and jti" do
      token = described_class.encode(user_id)
      payload, header = JWT.decode(
        token,
        secret,
        true,
        { verify_expiration: false, algorithm: "HS256" }
      )

      expect(payload["user_id"]).to eq(user_id)
      expect(payload["iat"]).to be_a(Integer)
      expect(payload).not_to have_key("exp")
      expect(payload).not_to have_key("jti")
      expect(header["alg"]).to eq("HS256")
    end
  end

  describe ".decode" do
    it "returns the payload for a valid token" do
      token = described_class.encode(user_id)
      expect(described_class.decode(token)["user_id"]).to eq(user_id)
    end

    it "returns nil for a token signed with a different secret" do
      token = JWT.encode({ "user_id" => user_id, "iat" => Time.now.to_i }, "other-secret", "HS256")
      expect(described_class.decode(token)).to be_nil
    end

    it "returns nil for a malformed token" do
      expect(described_class.decode("not-a-jwt")).to be_nil
    end

    it "rejects alg=none tokens" do
      token = JWT.encode({ "user_id" => user_id }, nil, "none", { typ: "JWT" })
      expect(described_class.decode(token)).to be_nil
    end

    it "does not reject a token that includes an expired exp" do
      token = JWT.encode(
        { "user_id" => user_id, "iat" => Time.now.to_i, "exp" => 1.day.ago.to_i },
        secret,
        "HS256"
      )
      expect(described_class.decode(token)["user_id"]).to eq(user_id)
    end
  end
end
