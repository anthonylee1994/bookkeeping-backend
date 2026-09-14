Rails.application.routes.draw do
  mount Rswag::Ui::Engine => "/api-docs" if defined?(Rswag::Ui::Engine)
  mount Rswag::Api::Engine => "/api-docs" if defined?(Rswag::Api::Engine)
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      post "auth/register", to: "auth#register"
      post "auth/login", to: "auth#login"
      get "me", to: "me#show"
      get "dashboard", to: "dashboard#show"
      get "summaries/daily", to: "summaries#daily"
      get "summaries/weekly", to: "summaries#weekly"
      get "summaries/monthly", to: "summaries#monthly"
      resources :accounts, only: %i[index create update destroy]
      resources :categories, only: %i[index create update destroy]
      resources :merchants, only: %i[index create destroy]
      resources :transactions, only: %i[index create show update destroy] do
        member do
          post :refund
          post :duplicate
        end
      end
      resources :recurring_rules, only: %i[index create update destroy] do
        member do
          post :pause
          post :resume
          post :run_now
          post :skip_next
        end
      end
      post "receipts/upload", to: "receipts#upload"
      post "ai/parse", to: "ai#parse"
      post "ai/confirm", to: "ai#confirm"
    end
  end
end
