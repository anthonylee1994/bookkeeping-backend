class ApplicationController < ActionController::API
  wrap_parameters false

  before_action :authenticate_user!
  before_action :catch_up_recurring

  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
  rescue_from ActionController::ParameterMissing, with: :render_parameter_missing

  def current_user
    @current_user
  end

  private

  def authenticate_user!
    token = bearer_token
    payload = token.present? ? JsonWebToken.decode(token) : nil
    @current_user = payload && User.find_by(id: payload["user_id"])
    render_error(code: "unauthorized", message: I18n.t("api.errors.unauthorized"), status: :unauthorized) unless @current_user
  end

  def bearer_token
    header = request.authorization
    return if header.blank?

    scheme, token = header.split(" ", 2)
    token.presence if scheme&.casecmp("Bearer")&.zero?
  end

  def user_payload(user)
    {
      id: user.id,
      username: user.username,
      timezone: user.timezone,
      currency: user.currency
    }
  end

  def render_error(code:, message:, status:, details: nil)
    body = { code: code, message: message, request_id: request.request_id }
    body[:details] = details if details.present?
    render json: { error: body }, status: status
  end

  def render_validation_error(record)
    render_error(
      code: "validation_error",
      message: record.errors.full_messages.first,
      details: record.errors.messages,
      status: :unprocessable_content
    )
  end

  def render_not_found
    render_error(code: "not_found", message: I18n.t("api.errors.not_found"), status: :not_found)
  end

  def render_parameter_missing(error)
    render_error(code: "validation_error", message: I18n.t("api.errors.parameter_missing", parameter: error.param), status: :unprocessable_content)
  end

  def catch_up_recurring
    RecurringCatchUp.call(user: current_user) if current_user
  end
end
