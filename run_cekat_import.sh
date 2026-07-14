#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-help}"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

print_usage() {
  cat <<'EOF'
Usage:
  ./run_cekat_import.sh all
      Import ulang data utama dari API ke MySQL.

  ./run_cekat_import.sh messages
      Lanjut ambil messages berdasarkan conversation_id yang sudah tersimpan.

  ./run_cekat_import.sh slow-messages
      Sama seperti messages, tapi delay lebih lambat untuk mengurangi rate-limit.

  ./run_cekat_import.sh status
      Tampilkan ringkasan row dan pending messages.

  ./run_cekat_import.sh migrate
      Buat/update schema database tanpa memanggil API.

Before running:
  cp .env.example .env
  Edit .env dan isi cekat_api_key + konfigurasi MySQL.
EOF
}

require_command node
require_command mysql

case "$MODE" in
  all)
    require_file ".env"
    require_file "Cekat Open API.postman_collection.json"
    require_file "import_cekat_collection.js"
    IMPORT_MODE=all \
    IMPORT_MESSAGES_BY_CONVERSATION=0 \
    IMPORT_DERIVED_DETAILS=0 \
    REQUEST_DELAY_MS="${REQUEST_DELAY_MS:-3000}" \
    RATE_LIMIT_RETRIES="${RATE_LIMIT_RETRIES:-5}" \
    RATE_LIMIT_DELAY_MS="${RATE_LIMIT_DELAY_MS:-120000}" \
    node import_cekat_collection.js
    ;;

  messages)
    require_file ".env"
    require_file "import_cekat_collection.js"
    IMPORT_MODE=messages_from_db \
    REQUEST_DELAY_MS="${REQUEST_DELAY_MS:-3000}" \
    RATE_LIMIT_RETRIES="${RATE_LIMIT_RETRIES:-5}" \
    RATE_LIMIT_DELAY_MS="${RATE_LIMIT_DELAY_MS:-120000}" \
    node import_cekat_collection.js
    ;;

  slow-messages)
    require_file ".env"
    require_file "import_cekat_collection.js"
    IMPORT_MODE=messages_from_db \
    REQUEST_DELAY_MS="${REQUEST_DELAY_MS:-8000}" \
    RATE_LIMIT_RETRIES="${RATE_LIMIT_RETRIES:-10}" \
    RATE_LIMIT_DELAY_MS="${RATE_LIMIT_DELAY_MS:-300000}" \
    node import_cekat_collection.js
    ;;

  status)
    require_file ".env"
    ./check_cekat_import_progress.sh
    ;;

  migrate)
    require_file ".env"
    require_file "import_cekat_collection.js"
    IMPORT_MODE=migrate node import_cekat_collection.js
    ;;

  help|--help|-h)
    print_usage
    ;;

  *)
    echo "Unknown mode: $MODE" >&2
    print_usage
    exit 1
    ;;
esac
