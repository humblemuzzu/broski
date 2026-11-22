# broski-relay. The build context is the Cargo workspace, packages/link:
#   docker build -f relay/Dockerfile -t broski-relay .
FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --locked -p broski-relay

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --home-dir /data --no-create-home relay \
  && mkdir /data && chown relay:relay /data
COPY --from=build /src/target/release/broski-relay /usr/local/bin/broski-relay
USER relay
VOLUME /data
EXPOSE 8765
ENTRYPOINT ["broski-relay"]
CMD ["--listen", "0.0.0.0:8765", "--db", "/data/relay.db"]
