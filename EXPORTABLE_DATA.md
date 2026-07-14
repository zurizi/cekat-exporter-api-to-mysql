# Exportable Data dari Cekat Open API Collection

Sumber: `Cekat Open API.postman_collection.json`

Dokumen ini merangkum data apa saja yang bisa diambil atau di-export berdasarkan endpoint yang ada di collection. Dari isi collection, export yang tersedia berbentuk response API JSON dari endpoint `GET` atau endpoint search, bukan endpoint download file seperti CSV/XLSX. Satu endpoint yang secara eksplisit memiliki parameter export adalah `GET /api/orders` melalui query `export_scope=all_with_filters`.

## Ringkasan

| Area data | Bisa di-export | Endpoint utama |
| --- | --- | --- |
| Business profile | Ya | `GET /businesses` |
| Inboxes | Ya | `GET /inboxes`, `GET /api/inboxes` |
| Templates | Ya | `GET /templates`, `GET /api/templates`, `GET /api/templates/pricing` |
| Messages | Ya | `GET /messages`, `GET /api/messages`, `GET /api/messages/summary/ai_credits` |
| Conversations | Ya | `GET /api/conversations`, `GET /api/conversations/:conversation_id` |
| Contacts | Ya | `GET /api/contacts`, `GET /api/crm/contact/:id` |
| CRM boards/items | Ya | `GET /api/crm/boards`, `GET /api/crm/boards/:boardId/items`, `POST /api/crm/boards/:boardId/items/search` |
| Orders | Ya | `GET /api/orders`, `GET /api/orders/:id` |
| Agents | Ya | `GET /api/agents` |
| Agent assignments | Ya | `GET /api/conversations/agent-assignments`, `GET /api/agent_assignments` |
| Broadcast campaigns | Ya | `GET /api/campaigns`, `GET /api/campaigns/:id/messages` |
| Integrations | Ya | `GET /integrations` |

## Authentication

Collection memakai beberapa tipe auth:

| Tipe | Header/token di collection | Dipakai pada |
| --- | --- | --- |
| Partner API key | `x-partner-api-key: {{PARTNER_API_KEY}}` | `POST /register` |
| Cekat API key | `api_key: {{CEKAT_API_KEY}}` | Endpoint lama seperti `/inboxes`, `/templates`, `/messages/whatsapp` |
| Bearer token | Bearer auth | Banyak endpoint `New Open API`, seperti orders, inboxes, campaigns, contacts |
| No auth | `noauth` | Beberapa endpoint conversation/message di collection masih ditandai no auth |

Base URL yang muncul di collection:

| Variable | Contoh penggunaan |
| --- | --- |
| `{{OPENAPI_LOCAL_SERVER}}` | Endpoint utama Open API |
| `{{OPEN_API_SERVER}}` | Endpoint send WhatsApp message |
| `{{base_url}}` | Endpoint backoffice/internal di folder Messages |

## Detail Data yang Bisa Di-export

### 1. Business Profile

Endpoint:

```http
GET {{OPENAPI_LOCAL_SERVER}}/businesses
```

Data yang tersedia dari contoh response:

| Field | Keterangan |
| --- | --- |
| `id` | ID business |
| `created_at` | Waktu business dibuat |
| `name` | Nama business |
| `email` | Email business |
| `phone_num` | Nomor telepon business |
| `package_type` | Tipe paket |
| `package_start_date` | Tanggal mulai paket |
| `package_exp_date` | Tanggal expired paket |
| `is_expired` | Status expired |
| `total_used_chat_credit_per_month` | Pemakaian chat credit bulanan |
| `chat_credit_topup` | Topup chat credit |
| `total_used_convo` | Pemakaian conversation credit |
| `convo_credit_topup` | Topup conversation credit |
| `open_api_key` | API key business |

Catatan: karena response berisi `open_api_key`, field ini sebaiknya tidak ikut masuk export publik.

### 2. Inboxes

Endpoint lama:

```http
GET {{OPENAPI_LOCAL_SERVER}}/inboxes
```

Endpoint New Open API:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/inboxes?limit=3&page=2
```

Filter yang ada di collection:

| Query | Status di collection | Keterangan |
| --- | --- | --- |
| `limit` | Aktif di New Open API | Jumlah data per halaman |
| `page` | Aktif di New Open API | Nomor halaman |
| `start_date` | Disabled | Filter tanggal mulai |
| `end_date` | Disabled | Filter tanggal akhir |

Data yang bisa di-export dari contoh schema endpoint lama:

| Field | Keterangan |
| --- | --- |
| `id` | ID inbox |
| `created_at` | Waktu inbox dibuat |
| `business_id` | ID business |
| `name` | Nama inbox |
| `description` | Deskripsi inbox |
| `phone_number` | Nomor WhatsApp |
| `status` | Status inbox |
| `ai_agent_id` | ID AI agent jika ada |
| `image_url` | URL gambar inbox jika ada |
| `type` | Tipe inbox, contoh `whatsapp` |

### 3. Templates dan Pricing

Endpoint lama:

```http
GET {{OPENAPI_LOCAL_SERVER}}/templates
```

Endpoint New Open API:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/templates?page=1&limit=1&start_date=2025-10-01&end_date=2025-10-07
GET {{OPENAPI_LOCAL_SERVER}}/api/templates/pricing?category=marketing&recipient_country_code=62&currency=IDR
```

Filter yang ada di collection:

| Query | Keterangan |
| --- | --- |
| `inbox_id` | Filter template per inbox pada endpoint lama |
| `status` | Disebut di deskripsi endpoint lama |
| `page` | Pagination template New Open API |
| `limit` | Pagination template New Open API |
| `start_date` | Filter tanggal mulai |
| `end_date` | Filter tanggal akhir |
| `category` | Kategori pricing template, contoh `marketing` |
| `recipient_country_code` | Kode negara penerima, contoh `62` |
| `currency` | Mata uang pricing, contoh `IDR` |

Data template yang bisa di-export dari schema endpoint lama:

| Field | Keterangan |
| --- | --- |
| `id` | ID template |
| `created_at` | Waktu dibuat |
| `body` | Body template |
| `wa_template_id` | ID template WhatsApp/Meta |
| `category` | Kategori template |
| `file_url` | URL file/header media |
| `status` | Status approval |
| `language` | Bahasa template |
| `inbox_id` | ID inbox |
| `name` | Nama template |
| `header_type` | Tipe header |
| `header` | Isi header |
| `body_placeholder` | Placeholder body |
| `inbox` | Detail inbox terkait |

### 4. Messages dan AI Credit Summary

Endpoint lama:

```http
GET {{OPENAPI_LOCAL_SERVER}}/messages?conversation_id=
```

Endpoint New Open API:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/messages
GET {{OPENAPI_LOCAL_SERVER}}/api/messages/summary/ai_credits?start_date=2025-08-08&end_date=2025-08-12
```

Filter yang ada di collection:

| Query | Keterangan |
| --- | --- |
| `conversation_id` | Ambil message untuk conversation tertentu |
| `start_date` | Filter tanggal mulai |
| `end_date` | Filter tanggal akhir |
| `page` | Pagination |
| `limit` | Jumlah data per halaman |

Data yang bisa di-export:

| Jenis export | Endpoint | Keterangan |
| --- | --- | --- |
| Message list/history | `GET /messages`, `GET /api/messages` | Riwayat pesan per conversation atau rentang tanggal |
| AI credit summary | `GET /api/messages/summary/ai_credits` | Ringkasan pemakaian credit AI berdasarkan tanggal, opsional per conversation |

### 5. Conversations

Endpoint list:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/conversations?limit=1&page=2
```

Endpoint detail:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/conversations/:conversation_id
```

Filter yang ada di collection:

| Query | Keterangan |
| --- | --- |
| `limit` | Jumlah data per halaman |
| `page` | Nomor halaman |
| `start_date` | Filter tanggal mulai |
| `end_date` | Filter tanggal akhir |

Data detail conversation yang tersedia dari contoh response:

| Field | Keterangan |
| --- | --- |
| `id` | ID conversation |
| `notes` | Catatan conversation |
| `labels` | Label yang terpasang, berisi `id`, `name`, `color` |
| `inbox_id` | ID inbox |
| `inbox_name` | Nama inbox |
| `pipeline` | Pipeline, berisi `id` dan `name` |
| `contact_id` | ID contact |
| `contact_name` | Nama contact |
| `contact_phone` | Nomor contact |
| `created_at` | Waktu conversation dibuat |
| `resolved_at` | Waktu resolved |
| `stage_status` | Status stage conversation |
| `platform_type` | Tipe platform, contoh `livechat` |
| `collaborators` | Agent/collaborator yang terlibat |
| `handled_by_id` | ID handler |
| `handled_by_name` | Nama handler |
| `resolved_by_id` | ID resolver |
| `resolved_by_name` | Nama resolver |
| `first_message` | Pesan pertama |
| `last_message` | Pesan terakhir |
| `last_message_by_human` | Pesan human terakhir, jika ada |
| `additional_data` | Data tambahan |

### 6. Contacts

Endpoint list:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/contacts?limit=2&page=1
```

Endpoint detail CRM contact:

```http
GET http://localhost:3001/api/crm/contact/{contact_id}
```

Filter yang ada di collection:

| Query | Keterangan |
| --- | --- |
| `limit` | Jumlah data per halaman |
| `page` | Nomor halaman |

Data yang bisa di-export:

| Jenis data | Keterangan |
| --- | --- |
| Contact list | Daftar contact dengan pagination |
| Contact detail | Detail per contact dari endpoint CRM |
| Additional data | Collection mencontohkan field `additional_data` saat create contact, sehingga kemungkinan detail contact dapat memuat metadata tambahan |

### 7. CRM Boards, Columns, dan Items

Endpoint:

```http
GET  {{OPENAPI_LOCAL_SERVER}}/api/crm/boards
GET  {{OPENAPI_LOCAL_SERVER}}/api/crm/boards/:id
GET  {{OPENAPI_LOCAL_SERVER}}/api/crm/boards/:boardId/columns/:columnId
GET  {{OPENAPI_LOCAL_SERVER}}/api/crm/boards/:boardId/items
GET  {{OPENAPI_LOCAL_SERVER}}/api/crm/boards/:boardId/items/:id
POST {{OPENAPI_LOCAL_SERVER}}/api/crm/boards/:boardId/items/search
```

Data yang bisa di-export:

| Jenis data | Endpoint | Keterangan |
| --- | --- | --- |
| Boards | `GET /api/crm/boards` | Daftar board CRM |
| Board detail | `GET /api/crm/boards/:id` | Detail board tertentu |
| Column detail | `GET /api/crm/boards/:boardId/columns/:columnId` | Detail kolom board |
| Items | `GET /api/crm/boards/:boardId/items` | Daftar item dalam board |
| Item detail | `GET /api/crm/boards/:boardId/items/:id` | Detail item termasuk group dan data conversation/contact terkait |
| Filtered items | `POST /api/crm/boards/:boardId/items/search` | Search item berdasarkan kondisi dan operator |

Operator search yang muncul di body collection:

| Operator | Contoh penggunaan |
| --- | --- |
| `contains` | Mencari text pada `item_name` atau kolom conversation |
| `is_not_empty` | Mencari field yang tidak kosong |
| `equals` | Cocok persis, termasuk value array |
| `greater_than_or_equal` | Filter angka minimal |
| `start_date` | Filter tanggal mulai |
| `end_date` | Filter tanggal akhir |
| `from_start_date` | Filter tanggal mulai untuk range timeline |
| `from_end_date` | Filter tanggal akhir untuk range timeline |
| `to_start_date` | Filter tujuan tanggal mulai untuk range timeline |
| `to_end_date` | Filter tujuan tanggal akhir untuk range timeline |

Field item detail yang disebut di deskripsi:

| Field | Keterangan |
| --- | --- |
| `item_id` | ID item |
| `item_name` | Nama item |
| `group_id` | ID group |
| `group_name` | Nama group |
| Dynamic column, contoh `Test Conversation` | Isi kolom custom, dapat berupa data conversation, contact, inbox, status, dan assignment |

### 8. Orders

Endpoint list:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/orders?page=1&limit=10
```

Endpoint detail:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/orders/:id
```

Filter yang ada di collection:

| Query | Status di collection | Keterangan |
| --- | --- | --- |
| `page` | Aktif | Nomor halaman |
| `limit` | Aktif | Jumlah data per halaman |
| `order_status` | Disabled | Filter status order, contoh `pending` |
| `payment_status` | Disabled | Filter status payment, contoh `paid` |
| `start_date` | Disabled | Filter tanggal mulai |
| `end_date` | Disabled | Filter tanggal akhir |
| `search` | Disabled | Pencarian text, contoh `.com` |
| `sort_field` | Disabled | Field sorting, contoh `created_at` |
| `sort_direction` | Disabled | Arah sorting, contoh `desc` |
| `include_conv` | Disabled | Sertakan data conversation |
| `inbox_id` | Disabled | Filter inbox |
| `product_ids` | Disabled | Filter product IDs |
| `export_scope` | Disabled | Scope export, contoh `all_with_filters` |

Data yang bisa di-export:

| Jenis data | Keterangan |
| --- | --- |
| Order list | Daftar order dengan pagination dan filter |
| Filtered export | Menggunakan `export_scope=all_with_filters` jika endpoint server mendukung parameter tersebut |
| Order detail | Detail order per `id` |
| Conversation context | Dapat disertakan dengan `include_conv=true` |

Catatan: `export_scope=all_with_filters` adalah indikasi paling kuat di collection bahwa endpoint orders mendukung mode export lintas halaman berdasarkan filter aktif.

### 9. Agents dan Agent Assignments

Endpoint agents:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/agents
```

Endpoint assignments:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/conversations/agent-assignments
GET {{OPENAPI_LOCAL_SERVER}}/api/agent_assignments?limit=1000&page=1&start_date=2025-12-06&end_date=2025-12-08
```

Filter yang ada di collection:

| Query | Endpoint | Keterangan |
| --- | --- | --- |
| `limit` | Agents, assignments | Jumlah data per halaman |
| `page` | Agents, assignments | Nomor halaman |
| `start_date` | Agents, assignments | Filter tanggal mulai |
| `end_date` | Agents, assignments | Filter tanggal akhir |

Data yang bisa di-export:

| Jenis data | Keterangan |
| --- | --- |
| Agents | Daftar agent |
| Conversation agent assignments | Assignment agent pada conversation |
| Agent assignment history | Data assignment berdasarkan rentang tanggal |

### 10. Broadcast Campaigns

Endpoint campaigns:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/campaigns?limit=1&page=1
```

Endpoint campaign messages:

```http
GET {{OPENAPI_LOCAL_SERVER}}/api/campaigns/:id/messages?page=1&limit=2
```

Filter yang ada di collection:

| Query | Keterangan |
| --- | --- |
| `limit` | Jumlah data per halaman |
| `page` | Nomor halaman |
| `start_date` | Filter tanggal mulai |
| `end_date` | Filter tanggal akhir |

Data yang bisa di-export:

| Jenis data | Keterangan |
| --- | --- |
| Campaign list | Daftar broadcast/campaign |
| Campaign messages | Pesan untuk campaign tertentu |

### 11. Integrations

Endpoint:

```http
GET {{OPENAPI_LOCAL_SERVER}}/integrations
```

Data yang bisa di-export:

| Jenis data | Keterangan |
| --- | --- |
| Integrations | Daftar integrasi yang tersambung ke business |

## Endpoint yang Bukan Export Data

Endpoint berikut lebih tepat dikategorikan sebagai mutasi data, sinkronisasi, atau aksi, bukan export:

| Endpoint | Fungsi |
| --- | --- |
| `POST /register` | Register business dan mendapatkan API key |
| `POST /templates/sync` | Sinkronisasi template dari Meta ke Cekat |
| `POST /templates` | Membuat template |
| `DELETE /templates/{{wa_template_id}}` | Menghapus template |
| `POST /templates/send` | Mengirim template message |
| `POST /messages/whatsapp` | Mengirim WhatsApp message |
| `DELETE /integrations/delete` | Menghapus integrasi |
| `POST /v1/backoffice/conversations-delete` | Menghapus conversation via endpoint backoffice |
| `POST /api/ai_response/beta` | Meminta AI response beta |
| `POST /api/crm/boards/:boardId/columns/by-name` | Mengambil kolom berdasarkan nama, tetapi memakai `POST` dengan body |
| `POST /api/crm/boards/:boardId/items` | Membuat CRM item |
| `PUT /api/crm/boards/:boardId/items/:itemId` | Update CRM item |
| `DELETE /api/crm/boards/:boardId/items` | Delete CRM items |
| `POST /api/crm/contact` | Membuat contact |
| `PUT /api/crm/contact/{contact_id}` | Update contact |
| `POST /api/orders` | Membuat order |
| `PUT /api/orders/:id` | Update order |
| `PUT /api/conversations/:id` | Update conversation |
| `DELETE /labels/assign/{id}` | Delete assigned label |

## Rekomendasi Format Export

Karena collection mayoritas mengembalikan JSON, format export bisa dibuat di sisi client/backend integrasi:

| Target format | Cocok untuk |
| --- | --- |
| JSON | Backup mentah, integrasi antar sistem, debugging |
| CSV | Report tabular seperti orders, contacts, inboxes, agents, campaigns |
| XLSX | Report bisnis dengan banyak sheet, misalnya orders + contacts + conversations |

Mapping sheet XLSX yang paling masuk akal:

| Sheet | Sumber endpoint |
| --- | --- |
| `business` | `GET /businesses` |
| `inboxes` | `GET /api/inboxes` |
| `templates` | `GET /api/templates` |
| `messages` | `GET /api/messages` |
| `ai_credit_summary` | `GET /api/messages/summary/ai_credits` |
| `conversations` | `GET /api/conversations` |
| `conversation_details` | `GET /api/conversations/:conversation_id` |
| `contacts` | `GET /api/contacts` |
| `crm_boards` | `GET /api/crm/boards` |
| `crm_items` | `GET /api/crm/boards/:boardId/items` atau `POST /api/crm/boards/:boardId/items/search` |
| `orders` | `GET /api/orders` |
| `agents` | `GET /api/agents` |
| `agent_assignments` | `GET /api/agent_assignments` |
| `campaigns` | `GET /api/campaigns` |
| `campaign_messages` | `GET /api/campaigns/:id/messages` |
| `integrations` | `GET /integrations` |

## Catatan Validasi

- Beberapa endpoint di collection tidak memiliki contoh response, sehingga field final perlu divalidasi ke server.
- Beberapa query masih berstatus disabled di Postman, tetapi tetap terdokumentasi sebagai filter potensial karena muncul di collection.
- Ada endpoint yang memakai `localhost:3001`; endpoint tersebut kemungkinan hanya untuk development/local dan perlu diganti base URL production sebelum dipakai export.
- Ada endpoint `noauth` pada conversation/message di collection. Sebelum production, auth behavior perlu dipastikan ulang.
