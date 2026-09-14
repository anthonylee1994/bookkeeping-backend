Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      post "auth/register", to: "auth#register"
      post "auth/login", to: "auth#login"
      get "me", to: "me#show"
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
