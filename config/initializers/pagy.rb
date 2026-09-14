# Be sure to restart your server when you modify this file.

require "pagy/extras/overflow"
require "pagy/extras/limit"

Pagy::DEFAULT[:limit] = 25
Pagy::DEFAULT[:limit_max] = 100
Pagy::DEFAULT[:max_per_page] = 100
Pagy::DEFAULT[:overflow] = :empty_page
