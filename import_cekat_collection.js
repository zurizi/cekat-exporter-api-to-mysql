#!/usr/bin/env node

const fs = require("fs");
const { spawn } = require("child_process");

const DB_NAME = process.env.DB_NAME || "cekat_collection_export";
const COLLECTION_FILE = "Cekat Open API.postman_collection.json";
const DEFAULT_BASE_URL = "https://api.cekat.ai";
const DEFAULT_LIMIT = Number(process.env.IMPORT_LIMIT || 100);
const INSERT_BATCH_SIZE = Number(process.env.INSERT_BATCH_SIZE || 100);
const MAX_PAGES = Number(process.env.MAX_PAGES || 1000);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const RATE_LIMIT_RETRIES = Number(process.env.RATE_LIMIT_RETRIES || 2);
const RATE_LIMIT_DELAY_MS = Number(process.env.RATE_LIMIT_DELAY_MS || 60000);
const IMPORT_DERIVED_DETAILS = process.env.IMPORT_DERIVED_DETAILS === "1";
const IMPORT_MESSAGES_BY_CONVERSATION = process.env.IMPORT_MESSAGES_BY_CONVERSATION !== "0";
const IMPORT_MODE = process.env.IMPORT_MODE || "all";
const MESSAGE_REQUEST_DELAY_MS = Number(process.env.MESSAGE_REQUEST_DELAY_MS || REQUEST_DELAY_MS);

const TABLES = [
  "businesses",
  "inboxes",
  "templates",
  "template_pricing",
  "messages",
  "message_ai_credit_summary",
  "conversations",
  "conversation_details",
  "contacts",
  "crm_boards",
  "crm_board_items",
  "orders",
  "order_details",
  "agents",
  "agent_assignments",
  "campaigns",
  "campaign_messages",
  "integrations",
];

const env = loadEnv(".env");
const baseUrl = trimTrailingSlash(env.OPENAPI_LOCAL_SERVER || DEFAULT_BASE_URL);
const apiKey = env.cekat_api_key || env.CEKAT_API_KEY || env.api_key || env.API_KEY;
const accessToken = env.access_token || env.ACCESS_TOKEN || apiKey;

const tableColumns = new Map();
const resultCache = {
  orderIds: new Set(),
  conversationIds: new Set(),
  campaignIds: new Set(),
  crmBoardIds: new Set(),
};
let activeRunId = null;

function loadEnv(path) {
  const output = { ...process.env };
  if (!fs.existsSync(path)) return output;

  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z")
    .replace(/'/g, "\\'")}'`;
}

function sqlIdent(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function mysqlArgs(withDb = false) {
  const args = [
    "-h",
    env.MYSQL_HOST || "127.0.0.1",
    "-P",
    env.MYSQL_PORT || "3306",
    "-u",
    env.MYSQL_USER || "root",
    "--batch",
    "--skip-column-names",
    "--default-character-set=utf8mb4",
  ];

  if (env.MYSQL_PASSWORD) args.push(`-p${env.MYSQL_PASSWORD}`);
  if (withDb) args.push(DB_NAME);
  return args;
}

function mysqlExec(sql, withDb = true) {
  return new Promise((resolve, reject) => {
    const child = spawn("mysql", mysqlArgs(withDb), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `mysql exited with code ${code}`));
    });
    child.stdin.end(sql);
  });
}

async function initDatabase() {
  await mysqlExec(
    `CREATE DATABASE IF NOT EXISTS ${sqlIdent(DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    false
  );

  await mysqlExec(`
CREATE TABLE IF NOT EXISTS import_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  endpoints_success INT NOT NULL DEFAULT 0,
  endpoints_failed INT NOT NULL DEFAULT 0,
  endpoints_skipped INT NOT NULL DEFAULT 0,
  total_rows BIGINT NOT NULL DEFAULT 0,
  error TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS endpoint_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT NOT NULL,
  endpoint_key VARCHAR(191) NOT NULL,
  table_name VARCHAR(191) NULL,
  source_method VARCHAR(20) NOT NULL,
  source_endpoint VARCHAR(500) NOT NULL,
  requested_url VARCHAR(1000) NULL,
  status VARCHAR(30) NOT NULL,
  source_status_code INT NULL,
  total_rows BIGINT NOT NULL DEFAULT 0,
  error TEXT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_import_run_id (import_run_id),
  INDEX idx_endpoint_key (endpoint_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_progress (
  endpoint_key VARCHAR(191) PRIMARY KEY,
  import_run_id BIGINT NULL,
  table_name VARCHAR(191) NULL,
  source_method VARCHAR(20) NOT NULL,
  source_endpoint VARCHAR(500) NOT NULL,
  requested_url VARCHAR(1000) NULL,
  status VARCHAR(30) NOT NULL,
  source_status_code INT NULL,
  current_page INT NULL,
  total_pages INT NULL,
  current_items INT NULL,
  total_items BIGINT NULL,
  cursor_id VARCHAR(191) NULL,
  cursor_ts VARCHAR(100) NULL,
  rows_seen BIGINT NOT NULL DEFAULT 0,
  rows_inserted BIGINT NOT NULL DEFAULT 0,
  last_external_id VARCHAR(191) NULL,
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_table_name (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_progress_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT NULL,
  endpoint_key VARCHAR(191) NOT NULL,
  table_name VARCHAR(191) NULL,
  source_method VARCHAR(20) NOT NULL,
  source_endpoint VARCHAR(500) NOT NULL,
  requested_url VARCHAR(1000) NULL,
  status VARCHAR(30) NOT NULL,
  source_status_code INT NULL,
  page_number INT NULL,
  total_pages INT NULL,
  current_items INT NULL,
  total_items BIGINT NULL,
  cursor_id VARCHAR(191) NULL,
  cursor_ts VARCHAR(100) NULL,
  rows_seen BIGINT NOT NULL DEFAULT 0,
  rows_inserted BIGINT NOT NULL DEFAULT 0,
  last_external_id VARCHAR(191) NULL,
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_endpoint_key (endpoint_key),
  INDEX idx_import_run_id (import_run_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`);

  for (const table of TABLES) {
    await createDataTable(table);
    await loadExistingColumns(table);
  }
}

async function createDataTable(table) {
  await mysqlExec(`
CREATE TABLE IF NOT EXISTS ${sqlIdent(table)} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT NULL,
  source_endpoint VARCHAR(500) NOT NULL,
  source_method VARCHAR(20) NOT NULL,
  source_status_code INT NULL,
  external_id VARCHAR(191) NULL,
  raw_json JSON NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_external_id (external_id),
  INDEX idx_import_run_id (import_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`);
}

async function loadExistingColumns(table) {
  const rows = await mysqlExec(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${sqlString(
      DB_NAME
    )} AND TABLE_NAME = ${sqlString(table)};`
  );
  const columns = new Set(
    rows
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  tableColumns.set(table, columns);
}

async function startRun() {
  const result = await mysqlExec(`
INSERT INTO import_runs (status) VALUES ('running');
SELECT LAST_INSERT_ID();
`);
  const lines = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Number(lines[lines.length - 1]);
}

async function finishRun(runId, status, counts, error = null) {
  await mysqlExec(`
UPDATE import_runs
SET finished_at = CURRENT_TIMESTAMP,
    status = ${sqlString(status)},
    endpoints_success = ${Number(counts.success || 0)},
    endpoints_failed = ${Number(counts.failed || 0)},
    endpoints_skipped = ${Number(counts.skipped || 0)},
    total_rows = ${Number(counts.rows || 0)},
    error = ${sqlString(error)}
WHERE id = ${Number(runId)};
`);
}

async function recordEndpointResult({
  runId,
  endpointKey,
  tableName,
  method,
  sourceEndpoint,
  requestedUrl,
  status,
  statusCode,
  totalRows,
  error,
}) {
  await mysqlExec(`
INSERT INTO endpoint_results (
  import_run_id, endpoint_key, table_name, source_method, source_endpoint,
  requested_url, status, source_status_code, total_rows, error
) VALUES (
  ${Number(runId)},
  ${sqlString(endpointKey)},
  ${sqlString(tableName)},
  ${sqlString(method)},
  ${sqlString(sourceEndpoint)},
  ${sqlString(requestedUrl)},
  ${sqlString(status)},
  ${statusCode == null ? "NULL" : Number(statusCode)},
  ${Number(totalRows || 0)},
  ${sqlString(error)}
);
`);
}

async function loadProgress(endpointKey) {
  const rows = await mysqlExec(`
SELECT status, current_page, total_pages, rows_seen, rows_inserted, cursor_id, cursor_ts
FROM import_progress
WHERE endpoint_key = ${sqlString(endpointKey)}
LIMIT 1;
`);
  const line = rows.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  if (!line) return null;

  const [status, currentPage, totalPages, rowsSeen, rowsInserted, cursorId, cursorTs] = line.split("\t");
  return {
    status,
    currentPage: Number(currentPage || 0),
    totalPages: Number(totalPages || 0),
    rowsSeen: Number(rowsSeen || 0),
    rowsInserted: Number(rowsInserted || 0),
    cursor: cursorId && cursorTs ? { cursor_id: cursorId, cursor_ts: cursorTs } : null,
  };
}

async function recordProgress({
  runId,
  endpointKey,
  tableName,
  method,
  sourceEndpoint,
  requestedUrl,
  status,
  statusCode,
  page,
  totalPages,
  currentItems,
  totalItems,
  cursor,
  rowsSeen,
  rowsInserted,
  lastExternalId,
  error,
}) {
  await mysqlExec(`
INSERT INTO import_progress (
  endpoint_key, import_run_id, table_name, source_method, source_endpoint,
  requested_url, status, source_status_code, current_page, total_pages,
  current_items, total_items, cursor_id, cursor_ts, rows_seen, rows_inserted,
  last_external_id, error
) VALUES (
  ${sqlString(endpointKey)},
  ${Number(runId)},
  ${sqlString(tableName)},
  ${sqlString(method)},
  ${sqlString(sourceEndpoint)},
  ${sqlString(requestedUrl)},
  ${sqlString(status)},
  ${statusCode == null ? "NULL" : Number(statusCode)},
  ${page == null ? "NULL" : Number(page)},
  ${totalPages == null ? "NULL" : Number(totalPages)},
  ${currentItems == null ? "NULL" : Number(currentItems)},
  ${totalItems == null ? "NULL" : Number(totalItems)},
  ${sqlString(cursor?.cursor_id || null)},
  ${sqlString(cursor?.cursor_ts || null)},
  ${Number(rowsSeen || 0)},
  ${Number(rowsInserted || 0)},
  ${sqlString(lastExternalId || null)},
  ${sqlString(error)}
)
ON DUPLICATE KEY UPDATE
  import_run_id = VALUES(import_run_id),
  table_name = VALUES(table_name),
  source_method = VALUES(source_method),
  source_endpoint = VALUES(source_endpoint),
  requested_url = VALUES(requested_url),
  status = VALUES(status),
  source_status_code = VALUES(source_status_code),
  current_page = VALUES(current_page),
  total_pages = VALUES(total_pages),
  current_items = VALUES(current_items),
  total_items = VALUES(total_items),
  cursor_id = VALUES(cursor_id),
  cursor_ts = VALUES(cursor_ts),
  rows_seen = VALUES(rows_seen),
  rows_inserted = VALUES(rows_inserted),
  last_external_id = VALUES(last_external_id),
  error = VALUES(error);

INSERT INTO import_progress_events (
  import_run_id, endpoint_key, table_name, source_method, source_endpoint,
  requested_url, status, source_status_code, page_number, total_pages,
  current_items, total_items, cursor_id, cursor_ts, rows_seen, rows_inserted,
  last_external_id, error
) VALUES (
  ${Number(runId)},
  ${sqlString(endpointKey)},
  ${sqlString(tableName)},
  ${sqlString(method)},
  ${sqlString(sourceEndpoint)},
  ${sqlString(requestedUrl)},
  ${sqlString(status)},
  ${statusCode == null ? "NULL" : Number(statusCode)},
  ${page == null ? "NULL" : Number(page)},
  ${totalPages == null ? "NULL" : Number(totalPages)},
  ${currentItems == null ? "NULL" : Number(currentItems)},
  ${totalItems == null ? "NULL" : Number(totalItems)},
  ${sqlString(cursor?.cursor_id || null)},
  ${sqlString(cursor?.cursor_ts || null)},
  ${Number(rowsSeen || 0)},
  ${Number(rowsInserted || 0)},
  ${sqlString(lastExternalId || null)},
  ${sqlString(error)}
);
`);
}

function normalizeUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

function withQuery(url, params) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

function authHeaders(auth) {
  const headers = {
    Accept: "application/json",
  };
  if (auth === "apikey") {
    if (!apiKey) throw new Error("Missing cekat_api_key/API key in .env");
    headers.api_key = apiKey;
  } else if (auth === "bearer") {
    if (!accessToken) throw new Error("Missing access_token or cekat_api_key for bearer auth");
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

async function apiRequest(args) {
  let lastRateLimitError = null;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await singleApiRequest(args);
    } catch (error) {
      if (error.statusCode !== 429 || attempt === RATE_LIMIT_RETRIES) throw error;
      lastRateLimitError = error;
      console.warn(
        `[rate-limit] waiting ${RATE_LIMIT_DELAY_MS}ms before retry ${attempt + 1}/${RATE_LIMIT_RETRIES}`
      );
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }
  throw lastRateLimitError;
}

async function singleApiRequest({ method = "GET", path, auth = "apikey", query, body }) {
  const url = withQuery(normalizeUrl(path), query);
  const headers = authHeaders(auth);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const options = { method, headers, signal: controller.signal };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  let text;
  try {
    response = await fetch(url, options);
    text = await response.text();
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      timeoutError.url = url;
      throw timeoutError;
    }
    error.url = url;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw_body: text };
    }
  }

  if (!response.ok) {
    const message = json && typeof json === "object" ? JSON.stringify(json) : text;
    const error = new Error(`HTTP ${response.status}: ${message.slice(0, 1000)}`);
    error.statusCode = response.status;
    error.url = url;
    error.responseJson = json;
    throw error;
  }

  return { statusCode: response.status, url, json };
}

function pickRecordContainer(json) {
  if (json === null || json === undefined) return [];
  if (Array.isArray(json)) return json;
  if (typeof json !== "object") return [{ value: json }];
  if (Array.isArray(json.data)) return json.data;
  if (json.data && typeof json.data === "object") {
    for (const key of [
      "items",
      "rows",
      "results",
      "records",
      "messages",
      "orders",
      "conversations",
      "templates",
      "contacts",
      "agents",
      "campaigns",
      "inboxes",
    ]) {
      if (Array.isArray(json.data[key])) return json.data[key];
    }
    return [json.data];
  }
  for (const key of ["items", "rows", "results", "records"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [json];
}

function hasMoreByMetadata(json, page, limit, count) {
  const meta = json && typeof json === "object" ? json.meta || json.pagination || json.data?.meta : null;
  const totalPages = Number(meta?.total_pages || meta?.last_page || meta?.totalPages || 0);
  if (totalPages) return page < totalPages;

  const total = Number(meta?.total || meta?.total_count || meta?.totalCount || 0);
  if (total) return page * limit < total;

  return count >= limit;
}

function nextCursor(json) {
  const cursor = json?.metadata?.next_cursor || json?.meta?.next_cursor || json?.pagination?.next_cursor;
  if (!cursor || typeof cursor !== "object") return null;
  if (!cursor.cursor_id || !cursor.cursor_ts) return null;
  return {
    cursor_id: cursor.cursor_id,
    cursor_ts: cursor.cursor_ts,
  };
}

function paginationMeta(json) {
  const pagination =
    json?.metadata?.pagination ||
    json?.meta?.pagination ||
    json?.pagination ||
    json?.data?.metadata?.pagination ||
    json?.data?.meta?.pagination ||
    null;

  if (!pagination || typeof pagination !== "object") {
    return {
      totalPages: null,
      currentItems: null,
      totalItems: null,
    };
  }

  return {
    totalPages: Number(
      pagination.total_page ||
        pagination.total_pages ||
        pagination.last_page ||
        pagination.totalPages ||
        0
    ) || null,
    currentItems: Number(
      pagination.current_items ||
        pagination.per_page ||
        pagination.count ||
        pagination.currentItems ||
        0
    ) || null,
    totalItems: Number(
      pagination.total_items ||
        pagination.total ||
        pagination.total_count ||
        pagination.totalItems ||
        0
    ) || null,
  };
}

function externalId(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return (
    row.id ||
    row.uuid ||
    row.item_id ||
    row.order_id ||
    row.conversation_id ||
    row.message_id ||
    row.wa_template_id ||
    null
  );
}

function collectIds(rows, targetSet) {
  for (const row of rows) {
    const id = externalId(row);
    if (id) targetSet.add(String(id));
  }
}

function pageSignature(rows) {
  return rows
    .map((row, index) => String(externalId(row) || `row_${index}:${JSON.stringify(row).slice(0, 120)}`))
    .join("|");
}

function sanitizeColumnName(key) {
  let name = String(key)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  if (!name) name = "value";
  if (/^[0-9]/.test(name)) name = `field_${name}`;
  if (["id", "raw_json", "external_id", "imported_at"].includes(name)) {
    name = `response_${name}`;
  }
  return name;
}

function isPrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function primitiveColumns(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    if (!isPrimitive(value)) continue;
    const column = sanitizeColumnName(key);
    output[column] = value === null || value === undefined ? null : String(value);
  }
  return output;
}

async function ensureColumns(table, columns) {
  const existing = tableColumns.get(table) || new Set();
  const missing = Object.keys(columns).filter((column) => !existing.has(column));
  if (missing.length === 0) return;

  for (const column of missing) {
    await mysqlExec(`ALTER TABLE ${sqlIdent(table)} ADD COLUMN ${sqlIdent(column)} TEXT NULL;`);
    existing.add(column);
  }
  tableColumns.set(table, existing);
}

async function filterNewRows(table, sourceEndpoint, rows) {
  const seenInBatch = new Set();
  const ids = [];
  const byId = new Map();
  const rowsWithoutId = [];

  for (const row of rows) {
    const id = externalId(row);
    if (!id) {
      rowsWithoutId.push(row);
      continue;
    }

    const idString = String(id);
    if (seenInBatch.has(idString)) continue;
    seenInBatch.add(idString);
    ids.push(idString);
    byId.set(idString, row);
  }

  if (ids.length === 0) return rowsWithoutId;

  const existingRows = await mysqlExec(`
SELECT external_id
FROM ${sqlIdent(table)}
WHERE source_endpoint = ${sqlString(sourceEndpoint)}
  AND external_id IN (${ids.map(sqlString).join(", ")});
`);
  const existing = new Set(
    existingRows
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const newRows = [];
  for (const id of ids) {
    if (!existing.has(id)) newRows.push(byId.get(id));
  }
  return [...newRows, ...rowsWithoutId];
}

async function insertRows({ runId, table, sourceEndpoint, method, statusCode, rows }) {
  if (!rows || rows.length === 0) return 0;

  const normalizedRowsAll = rows.map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? row : { value: row }
  );
  const normalizedRows = await filterNewRows(table, sourceEndpoint, normalizedRowsAll);
  if (normalizedRows.length === 0) return 0;

  const allColumns = {};
  for (const row of normalizedRows) {
    for (const [column, value] of Object.entries(primitiveColumns(row))) {
      allColumns[column] = value;
    }
  }
  await ensureColumns(table, allColumns);

  let inserted = 0;
  const dynamicColumns = Object.keys(allColumns);
  for (let offset = 0; offset < normalizedRows.length; offset += INSERT_BATCH_SIZE) {
    const batch = normalizedRows.slice(offset, offset + INSERT_BATCH_SIZE);
    const baseColumns = [
      "import_run_id",
      "source_endpoint",
      "source_method",
      "source_status_code",
      "external_id",
      "raw_json",
    ];
    const insertColumns = [...baseColumns, ...dynamicColumns];

    const valuesSql = batch
      .map((normalizedRow) => {
        const columns = primitiveColumns(normalizedRow);
        const values = [
          Number(runId),
          sqlString(sourceEndpoint),
          sqlString(method),
          statusCode == null ? "NULL" : Number(statusCode),
          sqlString(externalId(normalizedRow)),
          `CAST(${sqlString(JSON.stringify(normalizedRow))} AS JSON)`,
          ...dynamicColumns.map((column) => sqlString(columns[column] ?? null)),
        ];
        return `(${values.join(", ")})`;
      })
      .join(",\n");

    await mysqlExec(
      `INSERT INTO ${sqlIdent(table)} (${insertColumns
        .map(sqlIdent)
        .join(", ")}) VALUES ${valuesSql};`
    );
    inserted += batch.length;
  }
  return inserted;
}

async function importEndpoint(runId, config) {
  const method = config.method || "GET";
  const limit = config.limit || DEFAULT_LIMIT;

  if (config.skip) {
    await recordProgress({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: null,
      status: "skipped",
      statusCode: null,
      page: null,
      totalPages: null,
      currentItems: null,
      totalItems: null,
      cursor: null,
      rowsSeen: 0,
      rowsInserted: 0,
      lastExternalId: null,
      error: config.skip,
    });
    await recordEndpointResult({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: null,
      status: "skipped",
      statusCode: null,
      totalRows: 0,
      error: config.skip,
    });
    return { status: "skipped", rows: 0 };
  }

  const existingProgress = config.resumeProgress ? await loadProgress(config.key) : null;
  let totalRows = 0;
  let totalSeen = 0;
  let lastStatusCode = null;
  let lastUrl = null;
  let lastExternalId = null;
  let lastPage = existingProgress?.currentPage || null;
  let lastTotalPages = existingProgress?.totalPages || null;
  let lastCurrentItems = null;
  let lastTotalItems = null;
  let lastCursor = existingProgress?.cursor || null;

  await recordProgress({
    runId,
    endpointKey: config.key,
    tableName: config.table,
    method,
    sourceEndpoint: config.path,
    requestedUrl: null,
    status: "running",
    statusCode: null,
    page: existingProgress?.currentPage || null,
    totalPages: existingProgress?.totalPages || null,
    currentItems: null,
    totalItems: null,
    cursor: existingProgress?.cursor || null,
    rowsSeen: existingProgress?.rowsSeen || 0,
    rowsInserted: existingProgress?.rowsInserted || 0,
    lastExternalId: null,
    error: null,
  });

  try {
    if (config.cursorPaginated) {
      const seenPageSignatures = new Set();
      let cursor = existingProgress?.cursor || null;
      const startPage = existingProgress?.currentPage ? existingProgress.currentPage + 1 : 1;

      for (let page = startPage; page <= MAX_PAGES; page += 1) {
        const query = { ...(config.query || {}), limit };
        if (cursor) Object.assign(query, cursor);

        const result = await apiRequest({
          method,
          path: config.path,
          auth: config.auth,
          query,
          body: config.body,
        });
        lastStatusCode = result.statusCode;
        lastUrl = result.url;

        const rows = pickRecordContainer(result.json);
        totalSeen += rows.length;
        const signature = pageSignature(rows);
        if (page > startPage && seenPageSignatures.has(signature)) {
          console.warn(`[pagination] ${config.key} cursor page=${page} duplicates an earlier page; stopping.`);
          break;
        }
        seenPageSignatures.add(signature);

        const inserted = await insertRows({
          runId,
          table: config.table,
          sourceEndpoint: config.path,
          method,
          statusCode: result.statusCode,
          rows,
        });
        totalRows += inserted;
        if (config.collect) config.collect(rows);
        lastExternalId = rows.length ? externalId(rows[rows.length - 1]) : lastExternalId;
        cursor = nextCursor(result.json);
        lastPage = page;
        lastCurrentItems = rows.length;
        lastCursor = cursor;

        await recordProgress({
          runId,
          endpointKey: config.key,
          tableName: config.table,
          method,
          sourceEndpoint: config.path,
          requestedUrl: result.url,
          status: "page_done",
          statusCode: result.statusCode,
          page,
          totalPages: null,
          currentItems: rows.length,
          totalItems: null,
          cursor,
          rowsSeen: (existingProgress?.rowsSeen || 0) + totalSeen,
          rowsInserted: (existingProgress?.rowsInserted || 0) + totalRows,
          lastExternalId,
          error: null,
        });
        console.log(`[page] ${config.key} cursor_page=${page} rows=${rows.length} inserted=${inserted}`);

        if (!cursor || rows.length === 0) break;
        await sleep(REQUEST_DELAY_MS);
      }
    } else if (config.paginated) {
      const seenPageSignatures = new Set();
      const startPage = existingProgress?.currentPage ? existingProgress.currentPage + 1 : 1;

      for (let page = startPage; page <= MAX_PAGES; page += 1) {
        const query = { ...(config.query || {}), page, limit };
        const result = await apiRequest({
          method,
          path: config.path,
          auth: config.auth,
          query,
          body: config.body,
        });
        lastStatusCode = result.statusCode;
        lastUrl = result.url;

        const rows = pickRecordContainer(result.json);
        totalSeen += rows.length;
        const signature = pageSignature(rows);
        if (page > startPage && seenPageSignatures.has(signature)) {
          console.warn(`[pagination] ${config.key} page=${page} duplicates an earlier page; stopping.`);
          break;
        }
        seenPageSignatures.add(signature);

        const inserted = await insertRows({
          runId,
          table: config.table,
          sourceEndpoint: config.path,
          method,
          statusCode: result.statusCode,
          rows,
        });
        totalRows += inserted;
        if (config.collect) config.collect(rows);
        const meta = paginationMeta(result.json);
        lastExternalId = rows.length ? externalId(rows[rows.length - 1]) : lastExternalId;
        lastPage = page;
        lastTotalPages = meta.totalPages;
        lastCurrentItems = meta.currentItems || rows.length;
        lastTotalItems = meta.totalItems;

        await recordProgress({
          runId,
          endpointKey: config.key,
          tableName: config.table,
          method,
          sourceEndpoint: config.path,
          requestedUrl: result.url,
          status: "page_done",
          statusCode: result.statusCode,
          page,
          totalPages: meta.totalPages,
          currentItems: meta.currentItems || rows.length,
          totalItems: meta.totalItems,
          cursor: null,
          rowsSeen: (existingProgress?.rowsSeen || 0) + totalSeen,
          rowsInserted: (existingProgress?.rowsInserted || 0) + totalRows,
          lastExternalId,
          error: null,
        });
        console.log(`[page] ${config.key} page=${page} rows=${rows.length} inserted=${inserted}`);

        if (!hasMoreByMetadata(result.json, page, limit, rows.length)) break;
        await sleep(REQUEST_DELAY_MS);
      }
    } else {
      const result = await apiRequest({
        method,
        path: config.path,
        auth: config.auth,
        query: config.query,
        body: config.body,
      });
      lastStatusCode = result.statusCode;
      lastUrl = result.url;
      const rows = pickRecordContainer(result.json);
      totalSeen += rows.length;
      const inserted = await insertRows({
        runId,
        table: config.table,
        sourceEndpoint: config.path,
        method,
        statusCode: result.statusCode,
        rows,
      });
      totalRows += inserted;
      if (config.collect) config.collect(rows);
      lastExternalId = rows.length ? externalId(rows[rows.length - 1]) : null;
      lastPage = 1;
      lastTotalPages = 1;
      lastCurrentItems = rows.length;
      lastTotalItems = rows.length;

      await recordProgress({
        runId,
        endpointKey: config.key,
        tableName: config.table,
        method,
        sourceEndpoint: config.path,
        requestedUrl: result.url,
        status: "page_done",
        statusCode: result.statusCode,
        page: 1,
        totalPages: 1,
        currentItems: rows.length,
        totalItems: rows.length,
        cursor: null,
        rowsSeen: totalSeen,
        rowsInserted: totalRows,
        lastExternalId,
        error: null,
      });
      console.log(`[page] ${config.key} page=1 rows=${rows.length} inserted=${inserted}`);
    }

    await recordProgress({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: lastUrl,
      status: "success",
      statusCode: lastStatusCode,
      page: lastPage,
      totalPages: lastTotalPages,
      currentItems: lastCurrentItems,
      totalItems: lastTotalItems,
      cursor: lastCursor,
      rowsSeen: (existingProgress?.rowsSeen || 0) + totalSeen,
      rowsInserted: (existingProgress?.rowsInserted || 0) + totalRows,
      lastExternalId,
      error: null,
    });
    await recordEndpointResult({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: lastUrl,
      status: "success",
      statusCode: lastStatusCode,
      totalRows,
      error: null,
    });
    return { status: "success", rows: totalRows };
  } catch (error) {
    await recordProgress({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: error.url || lastUrl,
      status: "failed",
      statusCode: error.statusCode || lastStatusCode,
      page: lastPage,
      totalPages: lastTotalPages,
      currentItems: lastCurrentItems,
      totalItems: lastTotalItems,
      cursor: lastCursor,
      rowsSeen: (existingProgress?.rowsSeen || 0) + totalSeen,
      rowsInserted: (existingProgress?.rowsInserted || 0) + totalRows,
      lastExternalId,
      error: error.message,
    });
    await recordEndpointResult({
      runId,
      endpointKey: config.key,
      tableName: config.table,
      method,
      sourceEndpoint: config.path,
      requestedUrl: error.url || lastUrl,
      status: "failed",
      statusCode: error.statusCode || lastStatusCode,
      totalRows,
      error: error.message,
    });
    console.error(`[failed] ${config.key}: ${error.message}`);
    return { status: "failed", rows: totalRows, rateLimited: error.statusCode === 429 };
  }
}

function baseEndpointConfigs() {
  return [
    {
      key: "businesses",
      table: "businesses",
      path: "/businesses",
      auth: "apikey",
    },
    {
      key: "inboxes_legacy",
      table: "inboxes",
      path: "/inboxes",
      auth: "apikey",
      collect: (rows) => collectIds(rows, new Set()),
    },
    {
      key: "inboxes",
      table: "inboxes",
      path: "/api/inboxes",
      auth: "bearer",
      paginated: true,
    },
    {
      key: "templates_legacy",
      table: "templates",
      path: "/templates",
      auth: "apikey",
    },
    {
      key: "templates",
      table: "templates",
      path: "/api/templates",
      auth: "bearer",
      paginated: true,
    },
    {
      key: "template_pricing",
      table: "template_pricing",
      path: "/api/templates/pricing",
      auth: "bearer",
      query: {
        category: "marketing",
        recipient_country_code: "62",
        currency: "IDR",
      },
    },
    {
      key: "messages_legacy",
      table: "messages",
      path: "/messages",
      auth: "apikey",
      paginated: true,
      skip: "Skipped because production requires conversation_id; message export uses /api/messages.",
    },
    {
      key: "messages",
      table: "messages",
      path: "/api/messages",
      auth: "apikey",
      skip: "Skipped because complete message export is imported per conversation_id.",
    },
    {
      key: "message_ai_credit_summary",
      table: "message_ai_credit_summary",
      path: "/api/messages/summary/ai_credits",
      auth: "bearer",
      query: {
        start_date: env.SUMMARY_START_DATE || "2025-08-08",
        end_date: env.SUMMARY_END_DATE || "2025-08-12",
      },
    },
    {
      key: "agents",
      table: "agents",
      path: "/api/agents",
      auth: "apikey",
      paginated: true,
    },
    {
      key: "campaigns",
      table: "campaigns",
      path: "/api/campaigns",
      auth: "bearer",
      paginated: true,
      collect: (rows) => collectIds(rows, resultCache.campaignIds),
    },
    {
      key: "conversation_agent_assignments",
      table: "agent_assignments",
      path: "/api/conversations/agent-assignments",
      auth: "bearer",
      paginated: true,
    },
    {
      key: "agent_assignments",
      table: "agent_assignments",
      path: "/api/agent_assignments",
      auth: "bearer",
      paginated: true,
    },
    {
      key: "conversations",
      table: "conversations",
      path: "/api/conversations",
      auth: "bearer",
      cursorPaginated: true,
      collect: (rows) => collectIds(rows, resultCache.conversationIds),
    },
    {
      key: "contacts",
      table: "contacts",
      path: "/api/contacts",
      auth: "bearer",
      paginated: true,
    },
    {
      key: "crm_boards",
      table: "crm_boards",
      path: "/api/crm/boards",
      auth: "apikey",
      collect: (rows) => collectIds(rows, resultCache.crmBoardIds),
    },
    {
      key: "orders",
      table: "orders",
      path: "/api/orders",
      auth: "bearer",
      paginated: true,
      collect: (rows) => collectIds(rows, resultCache.orderIds),
    },
    {
      key: "integrations",
      table: "integrations",
      path: "/integrations",
      auth: "apikey",
    },
  ];
}

function derivedEndpointConfigs() {
  if (!IMPORT_DERIVED_DETAILS) return [];

  const configs = [];

  for (const id of resultCache.orderIds) {
    configs.push({
      key: `order_detail:${id}`,
      table: "order_details",
      path: `/api/orders/${encodeURIComponent(id)}`,
      auth: "bearer",
    });
  }

  for (const id of resultCache.conversationIds) {
    configs.push({
      key: `conversation_detail:${id}`,
      table: "conversation_details",
      path: `/api/conversations/${encodeURIComponent(id)}`,
      auth: "none",
    });
  }

  for (const id of resultCache.campaignIds) {
    configs.push({
      key: `campaign_messages:${id}`,
      table: "campaign_messages",
      path: `/api/campaigns/${encodeURIComponent(id)}/messages`,
      auth: "bearer",
      paginated: true,
    });
  }

  for (const id of resultCache.crmBoardIds) {
    configs.push({
      key: `crm_board_detail:${id}`,
      table: "crm_boards",
      path: `/api/crm/boards/${encodeURIComponent(id)}`,
      auth: "apikey",
    });
    configs.push({
      key: `crm_board_items:${id}`,
      table: "crm_board_items",
      path: `/api/crm/boards/${encodeURIComponent(id)}/items`,
      auth: "bearer",
      paginated: true,
    });
    configs.push({
      key: `crm_board_items_search:${id}`,
      table: "crm_board_items",
      path: `/api/crm/boards/${encodeURIComponent(id)}/items/search`,
      auth: "apikey",
      method: "POST",
      body: {
        condition: "AND",
        search: [],
      },
    });
  }

  return configs;
}

function messageByConversationConfigs() {
  if (!IMPORT_MESSAGES_BY_CONVERSATION) return [];

  const configs = [];
  for (const id of resultCache.conversationIds) {
    configs.push({
      key: `messages_by_conversation:${id}`,
      table: "messages",
      path: "/messages",
      auth: "apikey",
      paginated: false,
      resumeProgress: true,
      query: {
        conversation_id: id,
      },
    });
  }
  return configs;
}

async function loadPendingConversationIdsForMessages() {
  const rows = await mysqlExec(`
SELECT c.external_id
FROM conversations c
WHERE c.external_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM endpoint_results er
    WHERE er.endpoint_key = CONCAT('messages_by_conversation:', c.external_id)
      AND er.status = 'success'
  )
ORDER BY c.id;
`);
  for (const id of rows.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    resultCache.conversationIds.add(id);
  }
}

function validateCollectionExists() {
  if (!fs.existsSync(COLLECTION_FILE)) {
    throw new Error(`Missing ${COLLECTION_FILE}`);
  }
}

async function main() {
  validateCollectionExists();
  if (!apiKey && IMPORT_MODE !== "migrate") throw new Error("Missing cekat_api_key in .env");

  console.log(`Using base URL: ${baseUrl}`);
  console.log(`Using database: ${DB_NAME}`);

  await initDatabase();
  if (IMPORT_MODE === "migrate") {
    console.log("Database schema is up to date.");
    return;
  }

  const runId = await startRun();
  activeRunId = runId;
  const counts = { success: 0, failed: 0, skipped: 0, rows: 0 };

  try {
    if (IMPORT_MODE === "messages_from_db") {
      await loadPendingConversationIdsForMessages();
      console.log(`[mode] messages_from_db pending_conversations=${resultCache.conversationIds.size}`);
      console.log(
        `[estimate] minimum_delay=${formatDuration(
          resultCache.conversationIds.size * MESSAGE_REQUEST_DELAY_MS
        )} (${MESSAGE_REQUEST_DELAY_MS}ms x ${resultCache.conversationIds.size} conversations, excluding API time and rate-limit waits)`
      );
      for (const config of messageByConversationConfigs()) {
        console.log(`[import] ${config.key}`);
        const result = await importEndpoint(runId, config);
        counts[result.status] += 1;
        counts.rows += result.rows;
        if (result.rateLimited) {
          console.warn("[rate-limit] stopping messages-by-conversation imports.");
          break;
        }
        await sleep(MESSAGE_REQUEST_DELAY_MS);
      }

      const status = counts.failed > 0 ? "completed_with_errors" : "completed";
      await finishRun(runId, status, counts);
      activeRunId = null;
      console.log(
        `Done. run_id=${runId}, status=${status}, success=${counts.success}, failed=${counts.failed}, skipped=${counts.skipped}, rows=${counts.rows}`
      );
      return;
    }

    for (const config of baseEndpointConfigs()) {
      console.log(`[import] ${config.key}`);
      const result = await importEndpoint(runId, config);
      counts[result.status] += 1;
      counts.rows += result.rows;
      await sleep(REQUEST_DELAY_MS);
    }

    for (const config of messageByConversationConfigs()) {
      console.log(`[import] ${config.key}`);
      const result = await importEndpoint(runId, config);
      counts[result.status] += 1;
      counts.rows += result.rows;
      if (result.rateLimited) {
        console.warn("[rate-limit] stopping messages-by-conversation imports.");
        break;
      }
      await sleep(MESSAGE_REQUEST_DELAY_MS);
    }

    const blockedDerivedPrefixes = new Set();
    for (const config of derivedEndpointConfigs()) {
      const prefix = config.key.split(":")[0];
      if (blockedDerivedPrefixes.has(prefix)) continue;

      console.log(`[import] ${config.key}`);
      const result = await importEndpoint(runId, config);
      counts[result.status] += 1;
      counts.rows += result.rows;
      if (result.rateLimited) {
        console.warn(`[rate-limit] skipping remaining derived endpoints with prefix ${prefix}`);
        blockedDerivedPrefixes.add(prefix);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    const status = counts.failed > 0 ? "completed_with_errors" : "completed";
    await finishRun(runId, status, counts);
    activeRunId = null;
    console.log(
      `Done. run_id=${runId}, status=${status}, success=${counts.success}, failed=${counts.failed}, skipped=${counts.skipped}, rows=${counts.rows}`
    );
  } catch (error) {
    await finishRun(runId, "failed", counts, error.message);
    activeRunId = null;
    throw error;
  }
}

async function interrupt(signal) {
  if (activeRunId) {
    try {
      await finishRun(
        activeRunId,
        "interrupted",
        { success: 0, failed: 0, skipped: 0, rows: 0 },
        `Interrupted by ${signal}`
      );
    } catch {
      // Keep signal handling best-effort.
    }
  }
  process.exit(130);
}

process.on("SIGINT", () => interrupt("SIGINT"));
process.on("SIGTERM", () => interrupt("SIGTERM"));

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
