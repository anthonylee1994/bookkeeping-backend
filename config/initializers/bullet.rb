# Be sure to restart your server when you modify this file.

if defined?(Bullet)
  Rails.application.config.after_initialize do
    Bullet.enable = true
    Bullet.bullet_logger = true
    Bullet.rails_logger = true
    Bullet.raise = Rails.env.test?
  end
end
