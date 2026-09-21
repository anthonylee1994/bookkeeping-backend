# syntax=docker/dockerfile:1

FROM rust:1.98-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY migration ./migration
COPY src ./src
COPY config ./config
RUN cargo build --release --bin bookkeeping-backend-cli

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates sqlite3 tzdata \
    && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Hong_Kong
WORKDIR /app
COPY --from=builder /app/target/release/bookkeeping-backend-cli /app/bookkeeping-backend-cli
COPY config ./config
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/storage
EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
