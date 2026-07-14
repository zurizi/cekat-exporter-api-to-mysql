# Cekat Open API Data Import

Repo/folder ini berisi Postman collection Cekat dan script untuk mengambil data export/read-only dari API Cekat lalu menyimpannya ke MySQL.

Target utama:

- Import data utama seperti business, inboxes, conversations, contacts, agents, assignments, orders, campaigns, integrations.
- Import messages berdasarkan `conversation_id`.
- Simpan semua response penuh ke kolom `raw_json` agar field nested/dinamis tidak hilang.
- Bisa dilanjutkan dari VPS/komputer lain tanpa mengulang semua proses.

## File Penting

| File | Fungsi |
| --- | --- |
| `Cekat Open API.postman_collection.json` | Sumber endpoint dari Postman collection |
| `import_cekat_collection.js` | Script utama import API ke MySQL |
| `run_cekat_import.sh` | Wrapper untuk menjalankan import dengan mode yang aman |
| `check_cekat_import_progress.sh` | Script cek progress import |
| `.env.example` | Template environment variable |
| `CEKAT_IMPORT_GUIDE.md` | Panduan operator yang lebih detail |
| `EXPORTABLE_DATA.md` | Ringkasan data apa saja yang bisa diexport dari collection |

## Requirements

Butuh:

- Node.js 18 atau lebih baru
- MySQL server
- MySQL client CLI (`mysql`)
- API key Cekat

Script utama tidak memakai dependency npm eksternal.

## Setup

Copy template env:

```bash
cp .env.example .env
```

Isi `.env`:

```env
cekat_api_key=isi_api_key_cekat
OPENAPI_LOCAL_SERVER=https://api.cekat.ai
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
DB_NAME=cekat_collection_export
```

Buat script executable:

```bash
chmod +x run_cekat_import.sh check_cekat_import_progress.sh
```

## Cara Import

Import data utama:

```bash
./run_cekat_import.sh all
```

Import messages berdasarkan conversation yang sudah tersimpan:

```bash
./run_cekat_import.sh messages
```

Jika kena rate-limit, gunakan mode lebih lambat:

```bash
./run_cekat_import.sh slow-messages
```

Cek progress:

```bash
./run_cekat_import.sh status
```

## Mode Import

Wrapper `run_cekat_import.sh` menyediakan mode:

| Mode | Fungsi |
| --- | --- |
| `all` | Import ulang data utama. Tidak mengambil messages per conversation. |
| `messages` | Resume import messages dari `conversation_id` yang sudah ada di tabel `conversations`. |
| `slow-messages` | Sama seperti `messages`, tapi delay lebih lambat untuk mengurangi rate-limit. |
| `status` | Menampilkan ringkasan progress import. |
| `migrate` | Membuat/update schema database tanpa memanggil API. |

`messages` dan `slow-messages` aman dijalankan berulang. Script memakai tabel `endpoint_results` untuk mengetahui conversation mana yang sudah sukses diambil messages-nya. Jika proses putus di tengah page, script memakai `import_progress.current_page` sebagai titik resume dan tetap melakukan dedupe terhadap row yang sudah tersimpan.

## Database

Default database:

```text
cekat_collection_export
```

Tabel metadata:

| Tabel | Fungsi |
| --- | --- |
| `import_runs` | Riwayat run import |
| `endpoint_results` | Status setiap endpoint/request |
| `import_progress` | State progress terakhir per endpoint, termasuk page/cursor terakhir |
| `import_progress_events` | History progress per page/request |

Tabel data:

| Tabel | Isi |
| --- | --- |
| `businesses` | Business profile |
| `inboxes` | Inbox data |
| `templates` | Template data |
| `template_pricing` | Pricing template, jika API token mendukung |
| `messages` | Messages hasil import per conversation |
| `message_ai_credit_summary` | Summary AI credits |
| `conversations` | Conversation list |
| `conversation_details` | Detail conversation jika mode detail dijalankan |
| `contacts` | Contact list |
| `crm_boards` | CRM boards |
| `crm_board_items` | CRM board items |
| `orders` | Orders |
| `order_details` | Detail orders jika mode detail dijalankan |
| `agents` | Agents |
| `agent_assignments` | Agent assignments |
| `campaigns` | Broadcast/campaigns |
| `campaign_messages` | Campaign messages jika tersedia |
| `integrations` | Integrations |

Setiap tabel data minimal punya:

- `id`
- `import_run_id`
- `source_endpoint`
- `source_method`
- `source_status_code`
- `external_id`
- `raw_json`
- `imported_at`

Field primitive top-level dari response dibuat sebagai kolom tambahan. Field nested/object/array tetap aman di `raw_json`.

## Relasi Data

Conversation ID ada di:

```sql
conversations.external_id
```

Relasi utama:

```sql
contacts.external_id = conversations.contact_id
messages.conversation_id = conversations.external_id
```

Jumlah `contacts` bisa lebih banyak daripada `conversations`. Itu normal karena contacts adalah daftar contact yang tersimpan, sedangkan conversations adalah daftar percakapan yang tersedia dari endpoint conversation.

Contoh query:

```sql
SELECT
  c.external_id AS conversation_id,
  c.contact_id,
  ct.contact_name,
  COUNT(m.id) AS total_messages
FROM conversations c
LEFT JOIN contacts ct ON ct.external_id = c.contact_id
LEFT JOIN messages m ON m.conversation_id = c.external_id
GROUP BY c.external_id, c.contact_id, ct.contact_name
ORDER BY total_messages DESC
LIMIT 20;
```

## Catatan Teknis untuk AI Agent

- Jangan menjalankan endpoint mutasi dari collection seperti create, update, delete, send message, atau sync template.
- `GET /api/conversations` memakai cursor pagination, bukan `page`.
- Cursor conversation ada di `metadata.next_cursor.cursor_id` dan `metadata.next_cursor.cursor_ts`.
- `GET /api/messages` global tidak cukup untuk semua messages; messages lengkap harus diambil dengan `conversation_id`.
- Endpoint messages yang dipakai:

```http
GET /api/messages?conversation_id=<conversation_id>
```

- Import messages bisa kena API rate-limit karena request per conversation. Gunakan mode resume:

```bash
./run_cekat_import.sh messages
```

atau mode lambat:

```bash
./run_cekat_import.sh slow-messages
```

- Jangan drop database kalau hanya ingin melanjutkan import messages.
- Progress messages tersimpan di `import_progress` dengan key `messages_by_conversation:<conversation_id>`.
- History per page tersimpan di `import_progress_events`.
- Jika run putus, jalankan lagi mode `messages`; script akan lanjut dari progress terakhir dan tetap cross-check row existing agar tidak duplicate.
- Jika perlu reset total:

```bash
mysql -h127.0.0.1 -uroot -e "DROP DATABASE IF EXISTS cekat_collection_export;"
./run_cekat_import.sh all
./run_cekat_import.sh messages
```

## Known Issues

- `template_pricing` pernah gagal dengan error `Missing token`; kemungkinan butuh Bearer token berbeda atau scope tambahan.
- Beberapa endpoint collection mengembalikan data kosong dari API production, misalnya orders/templates/campaigns pada credential yang diuji.
- Message import membutuhkan waktu lama karena rate-limit API.
- `contacts` bisa lebih banyak dari `conversations` karena endpoint contacts menampilkan seluruh contact yang tersimpan, sedangkan conversations hanya conversation yang tersedia dari endpoint conversation.

## Validasi Cepat

Cek jumlah data:

```bash
./run_cekat_import.sh status
```

Jika database lama belum punya tabel progress, jalankan:

```bash
./run_cekat_import.sh migrate
```

Cek messages:

```bash
mysql -h127.0.0.1 -uroot cekat_collection_export -e "
SELECT COUNT(*) total_messages, COUNT(DISTINCT conversation_id) conversations_with_messages
FROM messages;
"
```

Cek page progress messages terakhir:

```bash
mysql -h127.0.0.1 -uroot cekat_collection_export -e "
SELECT endpoint_key, status, current_page, total_pages, rows_seen, rows_inserted, updated_at
FROM import_progress
WHERE endpoint_key LIKE 'messages_by_conversation:%'
ORDER BY updated_at DESC
LIMIT 20;
"
```

Cek pending messages:

```bash
mysql -h127.0.0.1 -uroot cekat_collection_export -e "
SELECT COUNT(*) pending
FROM conversations c
WHERE NOT EXISTS (
  SELECT 1
  FROM endpoint_results er
  WHERE er.endpoint_key = CONCAT('messages_by_conversation:', c.external_id)
    AND er.status = 'success'
);
"
```
