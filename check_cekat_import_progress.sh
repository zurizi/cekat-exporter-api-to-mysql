#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

DB_NAME="${DB_NAME:-cekat_collection_export}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"

MYSQL_ARGS=(-h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" --batch)
if [[ -n "$MYSQL_PASSWORD" ]]; then
  MYSQL_ARGS+=("-p$MYSQL_PASSWORD")
fi

mysql "${MYSQL_ARGS[@]}" "$DB_NAME" <<'SQL'
SELECT 'import_runs' AS section, '' AS metric, '' AS value;
SELECT id, status, endpoints_success, endpoints_failed, endpoints_skipped, total_rows, started_at, finished_at
FROM import_runs
ORDER BY id DESC
LIMIT 5;

SELECT 'row_counts' AS section, '' AS metric, '' AS value;
SELECT 'businesses' AS table_name, COUNT(*) AS row_count FROM businesses UNION ALL
SELECT 'inboxes', COUNT(*) FROM inboxes UNION ALL
SELECT 'templates', COUNT(*) FROM templates UNION ALL
SELECT 'messages', COUNT(*) FROM messages UNION ALL
SELECT 'message_ai_credit_summary', COUNT(*) FROM message_ai_credit_summary UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations UNION ALL
SELECT 'contacts', COUNT(*) FROM contacts UNION ALL
SELECT 'agents', COUNT(*) FROM agents UNION ALL
SELECT 'agent_assignments', COUNT(*) FROM agent_assignments UNION ALL
SELECT 'campaigns', COUNT(*) FROM campaigns UNION ALL
SELECT 'campaign_messages', COUNT(*) FROM campaign_messages UNION ALL
SELECT 'orders', COUNT(*) FROM orders UNION ALL
SELECT 'integrations', COUNT(*) FROM integrations
ORDER BY table_name;

SELECT 'messages_progress' AS section, '' AS metric, '' AS value;
SELECT
  (SELECT COUNT(*) FROM messages) AS total_messages,
  (SELECT COUNT(DISTINCT conversation_id) FROM messages) AS conversations_with_messages,
  (SELECT COUNT(*) FROM conversations c
   WHERE NOT EXISTS (
     SELECT 1
     FROM endpoint_results er
     WHERE er.endpoint_key = CONCAT('messages_by_conversation:', c.external_id)
       AND er.status = 'success'
   )) AS pending_conversations;

SELECT 'messages_page_progress' AS section, '' AS metric, '' AS value;
SELECT
  endpoint_key,
  status,
  current_page,
  total_pages,
  current_items,
  total_items,
  rows_seen,
  rows_inserted,
  updated_at
FROM import_progress
WHERE endpoint_key LIKE 'messages_by_conversation:%'
ORDER BY updated_at DESC
LIMIT 20;

SELECT 'recent_non_success_endpoints' AS section, '' AS metric, '' AS value;
SELECT endpoint_key, status, total_rows, LEFT(error, 180) AS error
FROM endpoint_results
WHERE status <> 'success'
ORDER BY id DESC
LIMIT 20;
SQL
