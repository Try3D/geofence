#!/usr/bin/env bash
set -euo pipefail

# Load local compose env so script uses the same DB credentials/port defaults.
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

IMPORT_MODE="create"
if [[ "${1:-}" == "--create" ]]; then
  IMPORT_MODE="create"
  shift
elif [[ "${1:-}" == "--append" ]]; then
  IMPORT_MODE="append"
  shift
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 [--create|--append] <path1.osm.pbf> [path2.osm.pbf ...] [-- extra osm2pgsql args]"
  exit 1
fi

PBF_PATHS=()
EXTRA_ARGS=()
PARSING_EXTRA=0

for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then
    PARSING_EXTRA=1
    continue
  fi

  if [[ $PARSING_EXTRA -eq 0 ]]; then
    PBF_PATHS+=("$arg")
  else
    EXTRA_ARGS+=("$arg")
  fi
done

if [[ ${#PBF_PATHS[@]} -eq 0 ]]; then
  echo "At least one .osm.pbf path is required."
  exit 1
fi

INPUT_FILES=()
for PBF_PATH in "${PBF_PATHS[@]}"; do
  if [[ "$PBF_PATH" = /* ]]; then
    echo "Please provide paths relative to the project root: $PBF_PATH"
    exit 1
  fi

  if [[ ! -f "$PBF_PATH" ]]; then
    echo "File not found: $PBF_PATH"
    exit 1
  fi

  INPUT_FILES+=("/work/${PBF_PATH#./}")
done

echo "Importing ${#INPUT_FILES[@]} file(s) with --${IMPORT_MODE} in a single osm2pgsql run"
OSM2PGSQL_CMD=(
  docker compose run --rm
  -e "PGPASSWORD=${POSTGRES_PASSWORD:-gis}"
  osm2pgsql
  "--${IMPORT_MODE}"
  --slim
  --hstore
  "--database=${POSTGRES_DB:-gis}"
  "--username=${POSTGRES_USER:-gis}"
  --host=postgis
  --port=5432
)
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  OSM2PGSQL_CMD+=("${EXTRA_ARGS[@]}")
fi
OSM2PGSQL_CMD+=("${INPUT_FILES[@]}")
"${OSM2PGSQL_CMD[@]}"
