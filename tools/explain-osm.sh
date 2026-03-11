#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <path.osm.pbf> [path2.osm.pbf ...]"
  echo "  Paths must be relative to the project root."
  exit 1
fi

for PBF_PATH in "$@"; do
  if [[ "$PBF_PATH" = /* ]]; then
    echo "Error: Please provide paths relative to the project root: $PBF_PATH"
    exit 1
  fi

  if [[ ! -f "$PBF_PATH" ]]; then
    echo "Error: File not found: $PBF_PATH"
    exit 1
  fi

  CONTAINER_PATH="/work/${PBF_PATH#./}"

  echo "========================================="
  echo "File: $PBF_PATH"
  echo "========================================="

  if docker compose run --rm osm2pgsql which osmium > /dev/null 2>&1; then
    echo "Using osmium from osm2pgsql image..."
    docker compose run --rm osm2pgsql osmium fileinfo -e "$CONTAINER_PATH"
  else
    echo "osmium not found in osm2pgsql image, installing via ubuntu:24.04..."
    HOST_FILE="$(pwd)/${PBF_PATH#./}"
    HOST_DIR="$(dirname "$HOST_FILE")"
    FILENAME="$(basename "$HOST_FILE")"
    docker run --rm \
      -v "${HOST_DIR}:/data" \
      ubuntu:24.04 \
      bash -c "
        apt-get update -qq &&
        apt-get install -y -qq osmium-tool &&
        osmium fileinfo -e /data/${FILENAME}
      "
  fi

  echo ""
done
