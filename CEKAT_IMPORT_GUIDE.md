# Panduan Import Data Cekat ke MySQL

Panduan ini untuk menjalankan import dari komputer kantor/VPS.

## File yang Perlu Dibawa

Pastikan file berikut ada dalam satu folder:

```text
Cekat Open API.postman_collection.json
import_cekat_collection.js
run_cekat_import.sh
check_cekat_import_progress.sh
.env
```

Jika belum ada `.env`, buat dari template:

```bash
cp .env.example .env
```

Lalu isi minimal:

```env
cekat_api_key=isi_api_key_cekat
OPENAPI_LOCAL_SERVER=https://api.cekat.ai
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
DB_NAME=cekat_collection_export
```

## Prasyarat Server

Butuh:

```text
Node.js 18+
mysql client
akses MySQL target
```

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nodejs mysql-client
```

macOS dengan Homebrew:

```bash
brew install node mysql-client
```

Tes koneksi MySQL:

```bash
mysql -h127.0.0.1 -uroot -e "SELECT VERSION();"
```

Jika MySQL memakai password, isi `MYSQL_PASSWORD` di `.env`.

## Cara Menjalankan

Masuk ke folder import:

```bash
cd /path/ke/folder/cekat-data
chmod +x run_cekat_import.sh check_cekat_import_progress.sh
```

Import data utama:

```bash
./run_cekat_import.sh all
```

Data utama mencakup business, inboxes, templates, conversations, contacts, agents, assignments, campaigns, orders, integrations, dan metadata endpoint. Mode ini tidak mengambil messages per conversation supaya tidak langsung kena rate-limit.

Lanjut ambil messages dari conversation yang sudah tersimpan:

```bash
./run_cekat_import.sh messages
```

Kalau sering kena rate-limit, pakai mode lambat:

```bash
./run_cekat_import.sh slow-messages
```

Mode messages aman dijalankan berkali-kali. Script akan melanjutkan conversation yang belum tercatat sukses di `endpoint_results`.

## Cek Progres

```bash
./run_cekat_import.sh status
```

Atau query manual:

```bash
mysql -h127.0.0.1 -uroot cekat_collection_export -e "
SELECT COUNT(*) total_messages, COUNT(DISTINCT conversation_id) conversations_with_messages
FROM messages;
"
```

Pending conversation yang belum selesai diambil messages-nya:

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

Contoh query:

```bash
mysql -h127.0.0.1 -uroot cekat_collection_export -e "
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
"
```

## Catatan Rate Limit

Import messages melakukan request per `conversation_id`, jadi jumlah request bisa ribuan. Jika API memberi rate-limit:

- tunggu beberapa menit, lalu jalankan lagi `./run_cekat_import.sh messages`
- atau gunakan `./run_cekat_import.sh slow-messages`
- jangan drop database saat hanya ingin melanjutkan messages

## Reset Database

Hanya lakukan ini kalau ingin import ulang dari nol:

```bash
mysql -h127.0.0.1 -uroot -e "DROP DATABASE IF EXISTS cekat_collection_export;"
./run_cekat_import.sh all
```

Setelah data utama selesai, jalankan:

```bash
./run_cekat_import.sh messages
```
