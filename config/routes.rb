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
    end
  end
end
