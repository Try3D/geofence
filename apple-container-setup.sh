#!/bin/bash

set -e

echo "Loading environment variables..."
set -a
source .env
set +a

echo "Starting container system..."
yes | container system start || true

echo "Stopping existing container if it exists..."
container stop postgis 2>/dev/null || true

echo "Removing existing container if it exists..."
container rm postgis 2>/dev/null || true

echo "Starting PostGIS container..."
container run -d \
  --name postgis \
  -e POSTGRES_DB=$POSTGRES_DB \
  -e POSTGRES_USER=$POSTGRES_USER \
  -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
  -p ${POSTGRES_PORT:-5433}:5432 \
  imresamu/postgis

echo "PostGIS container started successfully."
