# Ruby 4 JSON.parse only accepts keyword options. Rails 8.1 still calls
# JSON.parse(json, options_hash) with a positional hash, which 400s every
# JSON request. Restore the old positional-hash form.

module JsonParsePositionalOptions
  def parse(source, opts = nil, **kwargs)
    if opts.is_a?(Hash)
      super(source, **opts, **kwargs)
    elsif opts.nil?
      super(source, **kwargs)
    else
      super
    end
  end
end

JSON.singleton_class.prepend(JsonParsePositionalOptions)
