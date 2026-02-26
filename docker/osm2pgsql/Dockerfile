FROM --platform=$TARGETPLATFORM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends osm2pgsql ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["osm2pgsql"]
