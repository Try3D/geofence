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

IMPORT_MODE="create"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-gis}"
DB_PASSWORD="${POSTGRES_PASSWORD:-gis}"
DB_NAME="${POSTGRES_DB:-gis}"
CACHE_MB="${OSM2PGSQL_CACHE:-16000}"
NUM_PROCESSES="${OSM2PGSQL_PROCS:-$(nproc 2>/dev/null || echo 4)}"
PBF_PATHS=()
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --create)     IMPORT_MODE="create";               shift ;;
    --append)     IMPORT_MODE="append";               shift ;;
    --host=*)     DB_HOST="${1#--host=}";             shift ;;
    --host)       DB_HOST="$2";                       shift 2 ;;
    --port=*)     DB_PORT="${1#--port=}";             shift ;;
    --port)       DB_PORT="$2";                       shift 2 ;;
    --user=*)     DB_USER="${1#--user=}";             shift ;;
    --user)       DB_USER="$2";                       shift 2 ;;
    --password=*) DB_PASSWORD="${1#--password=}";     shift ;;
    --password)   DB_PASSWORD="$2";                   shift 2 ;;
    --database=*) DB_NAME="${1#--database=}";         shift ;;
    --database)   DB_NAME="$2";                       shift 2 ;;
    --cache=*)    CACHE_MB="${1#--cache=}";           shift ;;
    --cache)      CACHE_MB="$2";                      shift 2 ;;
    --procs=*)    NUM_PROCESSES="${1#--procs=}";      shift ;;
    --procs)      NUM_PROCESSES="$2";                 shift 2 ;;
    --)           shift; break ;;
    -*)           echo "Unknown option: $1"; exit 1 ;;
    *)            PBF_PATHS+=("$1");                  shift ;;
  esac
done

EXTRA_ARGS+=("$@")

if [[ ${#PBF_PATHS[@]} -eq 0 ]]; then
  echo "Usage: $0 [--create|--append] [--host H] [--port P] [--user U] [--password W] [--database D]"
  echo "          [--cache MB] [--procs N] <path1.osm.pbf> [path2.osm.pbf ...] [-- extra osm2pgsql args]"
  echo ""
  echo "  --cache MB   Node cache size in MB (default: 16000)"
  echo "  --procs N    Number of parallel worker processes (default: nproc)"
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

echo "============================================"
echo " Importing ${#INPUT_FILES[@]} file(s)"
echo " Mode:      --${IMPORT_MODE}"
echo " Target:    ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo " Cache:     ${CACHE_MB} MB"
echo " Workers:   ${NUM_PROCESSES}"
echo "============================================"

echo ""
echo "Running migrations to ensure extensions exist..."
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
sqlx migrate run --source db/migrations --database-url "$DATABASE_URL"

OSM2PGSQL_CMD=(
  docker compose run --rm
  -e "PGPASSWORD=${DB_PASSWORD}"
  osm2pgsql
  "--${IMPORT_MODE}"
  --slim
  --hstore
  "--cache=${CACHE_MB}"
  "--number-processes=${NUM_PROCESSES}"
  "--database=${DB_NAME}"
  "--username=${DB_USER}"
  "--host=${DB_HOST}"
  "--port=${DB_PORT}"
)

if [[ "${IMPORT_MODE}" == "create" ]]; then
  OSM2PGSQL_CMD+=("--drop")
fi

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  OSM2PGSQL_CMD+=("${EXTRA_ARGS[@]}")
fi

OSM2PGSQL_CMD+=("${INPUT_FILES[@]}")

"${OSM2PGSQL_CMD[@]}"
