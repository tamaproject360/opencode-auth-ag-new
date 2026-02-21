# OpenCode AG Auth (Antigravity Guard)

[![npm version](https://img.shields.io/npm/v/opencode-ag-auth.svg)](https://www.npmjs.com/package/opencode-ag-auth)
[![npm beta](https://img.shields.io/npm/v/opencode-ag-auth/beta.svg?label=beta)](https://www.npmjs.com/package/opencode-ag-auth)
[![npm downloads](https://img.shields.io/npm/dw/opencode-ag-auth.svg)](https://www.npmjs.com/package/opencode-ag-auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-tamaproject360-181717?style=flat&logo=github)](https://github.com/tamaproject360)

**Plugin Antigravity untuk OpenCode yang fokus pada keamanan dan stabilitas.**

Plugin ini membantu OpenCode login ke **Antigravity** (IDE Google) dengan perlindungan akun dan sesi yang lebih stabil. Anda bisa memakai model seperti `gemini-3.1-pro` dan `claude-opus-4-6-thinking` dengan risiko yang lebih terkontrol.

## Kenapa Fork Ini?

Ini adalah fork khusus dari `opencode-antigravity-auth` yang fokus ke **safety** dan **reliability** untuk penggunaan harian, termasuk workflow agent.

### 🛡️ Perlindungan yang Ditingkatkan
- **Strict Quota Protocol (SQP)**: Menerapkan **safety buffer 70%** pada pemakaian API. Akun akan dikunci sebelum menyentuh batas abuse Google.
- **Leak-Proof Locking**: Akun yang terkunci diabaikan sampai waktu reset spesifiknya lewat, sehingga tidak terjadi penggunaan "bocor" akibat cache kedaluwarsa.

### ⚡ Stabilitas Agent
- **Integrasi Oh-My-OpenCode**: Dukungan native untuk session recovery. Menangani crash tool dan blok "thinking" model secara otomatis.
- **Smart Proxy Support**: Dukungan proxy `undici` yang siap untuk kebutuhan jaringan kompleks.
- **Interactive Pause**: Eksekusi dapat pause secara elegan saat quota menipis, sehingga tidak langsung crash.

## Fitur Utama

- **Semua Model Antigravity**: Claude Opus 4.6, Sonnet 4.6, serta Gemini 3.1 Pro/Flash via Google OAuth.
- **Thinking Models**: Budget thinking dapat dikonfigurasi untuk tugas penalaran kompleks.
- **Rotasi Multi-Akun**: Tambahkan akun Google tanpa batas; rotasi akun otomatis berdasarkan health dan quota.
- **Dual Quota Pools**: Routing cerdas antara quota Antigravity dan Gemini CLI.
- **Google Search Grounding**: Aktifkan pencarian web real-time untuk model Gemini.

## Progress & Pengembangan Terbaru

- **Pemilihan akun manual** langsung dari `opencode auth login` lewat tombol *Use this account now*.
- **Status akun lebih jelas**: ada label `[403 forbidden]`, `[needs verification]`, `[rate-limited]`, serta toggle enable/disable massal (Enable all / Disable all).
- **Proteksi refresh token**: saat refresh berhasil, akun otomatis aktif lagi dan flag verifikasi/forbidden di-reset.
- **Soft quota** bawa default 70% dengan opsi override di `antigravity.json`, plus prompt error yang menjelaskan cara menonaktifkan.
- **Menu tindakan baru**: cepat memverifikasi satu akun, semua akun, dan cek quota dengan log terperinci.

---

<details open>
<summary><b>⚠️ Peringatan Terms of Service — Baca Sebelum Install</b></summary>

> [!CAUTION]
> Penggunaan plugin ini dapat melanggar Terms of Service Google. Sejumlah kecil pengguna melaporkan akun Google mereka **dibanned** atau **shadow-banned** (akses dibatasi tanpa notifikasi eksplisit).
>
> **Skenario berisiko tinggi:**
> - 🚨 **Akun Google baru** punya peluang ban yang sangat tinggi
> - 🚨 **Akun baru dengan langganan Pro/Ultra** sering ter-flag dan dibanned
>
> **Dengan menggunakan plugin ini, Anda memahami bahwa:**
> - Ini adalah tool tidak resmi dan tidak didukung Google
> - Akun Anda bisa disuspend atau diban permanen
> - Seluruh risiko penggunaan menjadi tanggung jawab Anda
>
> **Rekomendasi:** Gunakan akun Google yang sudah mapan dan bukan akun untuk layanan kritikal. Hindari membuat akun baru khusus untuk plugin ini.

</details>

---

## Instalasi

<details open>
<summary><b>Untuk Pengguna</b></summary>

**Opsi A: Biarkan LLM yang mengerjakan**

Tempel prompt berikut ke agent LLM apa pun (Claude Code, OpenCode, Cursor, dll):

```
Install the opencode-ag-auth plugin and add the Antigravity model definitions to ~/.config/opencode/opencode.json by following: https://raw.githubusercontent.com/tamaproject360/opencode-ag-auth/main/README.md
```

**Opsi B: Setup manual (NPM)**

1. **Tambahkan plugin** ke `~/.config/opencode/opencode.json` (OpenCode akan auto-install dari NPM):

   ```json
   {
     "plugin": ["opencode-ag-auth@latest"]
   }
   ```

   > Ingin fitur paling baru? Gunakan `opencode-ag-auth@beta`.

2. **Login** dengan akun Google Anda:

   ```bash
   opencode auth login
   ```

3. **Tambahkan model** — pilih salah satu:
   - Jalankan `opencode auth login` → pilih **"Configure models in opencode.json"** (otomatis menambahkan semua model)
   - Atau copy manual dari [konfigurasi lengkap](#models) di bawah

4. **Gunakan plugin:**

   ```bash
   opencode run "Hello" --model=google/antigravity-claude-sonnet-4-6-thinking --variant=max
   ```

</details>

<details>
<summary><b>Untuk Agent LLM</b></summary>

### Langkah Implementasi

1. Edit file konfigurasi OpenCode di `~/.config/opencode/opencode.json`

   > **Catatan**: Path ini berlaku di semua platform. Di Windows, `~` akan resolve ke home user (misalnya `C:\Users\YourName`).

2. Tambahkan plugin ke array `plugin`

3. Tambahkan definisi model dari bagian [Full models configuration](#models)

4. Set `provider` ke `"google"` dan pilih model default

### Verifikasi

```bash
opencode run "Hello" --model=google/antigravity-claude-sonnet-4-6-thinking --variant=max
```

</details>


Untuk panduan instalasi lengkap (termasuk metode manual dan protokol lanjutan untuk agent), lihat [docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## Models

### Referensi Model

**Quota Antigravity** (routing default untuk Claude dan Gemini):

| Model | Variants | Catatan |
|-------|----------|---------|
| `antigravity-gemini-3.1-pro` | low, high | Gemini 3.1 Pro dengan thinking |
| `antigravity-gemini-3-flash` | minimal, low, medium, high | Gemini 3 Flash dengan thinking |
| `antigravity-claude-sonnet-4-6` | — | Claude Sonnet 4.6 |
| `antigravity-claude-sonnet-4-6-thinking` | low, max | Claude Sonnet dengan extended thinking |

| `antigravity-claude-opus-4-6-thinking` | low, max | Claude Opus 4.6 dengan extended thinking |

**Quota Gemini CLI** (terpisah dari Antigravity; dipakai saat `cli_first` true atau saat fallback):

| Model | Catatan |
|-------|---------|
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `gemini-3-flash-preview` | Gemini 3 Flash (preview) |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (preview) |

> **Perilaku Routing:**
> - **Antigravity-first (default):** model Gemini memakai quota Antigravity lintas akun.
> - **CLI-first (`cli_first: true`):** model Gemini memakai quota Gemini CLI terlebih dahulu.
> - Saat salah satu pool quota Gemini habis, plugin otomatis fallback ke pool lainnya.
> - Model Claude dan image selalu lewat Antigravity.
> Nama model ditransformasikan otomatis sesuai API tujuan (contoh: `antigravity-gemini-3-flash` → `gemini-3-flash-preview` untuk CLI).

**Contoh pakai varian:**
```bash
opencode run "Hello" --model=google/antigravity-claude-sonnet-4-6-thinking --variant=max
```

Detail konfigurasi variant dan level thinking ada di [docs/MODEL-VARIANTS.md](docs/MODEL-VARIANTS.md).

<details>
<summary><b>Full models configuration (siap copy-paste)</b></summary>

Tambahkan ini ke `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ag-auth@latest"],
  "provider": {
    "google": {
      "models": {
        "antigravity-gemini-3.1-pro": {
          "name": "Gemini 3.1 Pro (Antigravity)",
          "limit": { "context": 1048576, "output": 65535 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "thinkingLevel": "low" },
            "high": { "thinkingLevel": "high" }
          }
        },
        "antigravity-gemini-3-flash": {
          "name": "Gemini 3 Flash (Antigravity)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "minimal": { "thinkingLevel": "minimal" },
            "low": { "thinkingLevel": "low" },
            "medium": { "thinkingLevel": "medium" },
            "high": { "thinkingLevel": "high" }
          }
        },
        "antigravity-claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6 (Antigravity)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "antigravity-claude-sonnet-4-6-thinking": {
          "name": "Claude Sonnet 4.6 Thinking (Antigravity)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "thinkingConfig": { "thinkingBudget": 8192 } },
            "max": { "thinkingConfig": { "thinkingBudget": 32768 } }
          }
        },

        "antigravity-claude-opus-4-6-thinking": {
          "name": "Claude Opus 4.6 Thinking (Antigravity)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
          "variants": {
            "low": { "thinkingConfig": { "thinkingBudget": 8192 } },
            "max": { "thinkingConfig": { "thinkingBudget": 32768 } }
          }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash (Gemini CLI)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (Gemini CLI)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gemini-3-flash-preview": {
          "name": "Gemini 3 Flash Preview (Gemini CLI)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gemini-3.1-pro-preview": {
          "name": "Gemini 3.1 Pro Preview (Gemini CLI)",
          "limit": { "context": 1048576, "output": 65535 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        }
      }
    }
  }
}
```

> **Backward Compatibility:** Nama model legacy dengan prefix `antigravity-` (mis. `antigravity-gemini-3-flash`) tetap didukung. Plugin akan melakukan transformasi nama model otomatis untuk API Antigravity dan Gemini CLI.

</details>

---

## Multi-Account Setup

Tambahkan beberapa akun Google untuk menambah quota gabungan. Plugin akan merotasi akun secara otomatis saat salah satu akun rate-limited.

```bash
opencode auth login  # Jalankan lagi untuk menambah akun
```

**Opsi manajemen akun (via `opencode auth login`):**
- **Configure models** — Konfigurasi otomatis semua model plugin di `opencode.json`
- **Check quotas** — Lihat sisa quota API setiap akun
- **Manage accounts** — Enable/disable akun tertentu untuk rotasi

Detail load balancing, dual quota pools, dan penyimpanan akun ada di [docs/MULTI-ACCOUNT.md](docs/MULTI-ACCOUNT.md).

---

## Troubleshoot

> **Quick Reset**: Sebagian besar masalah selesai dengan menghapus `~/.config/opencode/antigravity-accounts.json` lalu login ulang lewat `opencode auth login`.

### Path Konfigurasi (Semua Platform)

OpenCode menggunakan `~/.config/opencode/` di **semua platform**, termasuk Windows.

| File | Path |
|------|------|
| Main config | `~/.config/opencode/opencode.json` |
| Accounts | `~/.config/opencode/antigravity-accounts.json` |
| Plugin config | `~/.config/opencode/antigravity.json` |
| Debug logs | `~/.config/opencode/antigravity-logs/` |

> **Pengguna Windows**: `~` akan resolve ke home user (mis. `C:\Users\YourName`). Jangan gunakan `%APPDATA%`.

> **Custom path**: set environment variable `OPENCODE_CONFIG_DIR` untuk memakai lokasi config khusus.

> **Migrasi Windows**: Jika upgrade dari plugin v1.3.x atau lebih lama, plugin akan otomatis mencari config lama di `%APPDATA%\opencode\` dan memakainya. Instalasi baru tetap memakai `~/.config/opencode/`.

---

### Masalah Auth Multi-Akun

Jika ada masalah autentikasi pada multi-akun:

1. Hapus file akun:
   ```bash
   rm ~/.config/opencode/antigravity-accounts.json
   ```
2. Login ulang:
   ```bash
   opencode auth login
   ```

---

### 403 Permission Denied (`rising-fact-p41fc`)

**Error:**
```
Permission 'cloudaicompanion.companions.generateChat' denied on resource
'//cloudaicompanion.googleapis.com/projects/rising-fact-p41fc/locations/global'
```

**Penyebab:** Plugin fallback ke project ID default saat project valid tidak ditemukan. Ini bisa jalan di Antigravity, tapi gagal untuk model Gemini CLI.

**Solusi:**
1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat atau pilih project
3. Aktifkan **Gemini for Google Cloud API** (`cloudaicompanion.googleapis.com`)
4. Tambahkan `projectId` ke file akun:
   ```json
   {
     "accounts": [
       {
         "email": "your@email.com",
         "refreshToken": "...",
         "projectId": "your-project-id"
       }
     ]
   }
   ```

> **Catatan**: Lakukan ini untuk setiap akun pada setup multi-akun.

---

### Gemini Model Not Found

Tambahkan ini pada konfigurasi provider `google` Anda:

```json
{
  "provider": {
    "google": {
      "npm": "@ai-sdk/google",
      "models": { ... }
    }
  }
}
```

---

### Gemini 3 Models 400 Error ("Unknown name 'parameters'")

**Error:**
```
Invalid JSON payload received. Unknown name "parameters" at 'request.tools[0]'
```

**Penyebab umum:**
- Skema tool tidak kompatibel dengan validasi protobuf ketat di Gemini
- MCP server mengirim skema malformed
- Regresi versi plugin

**Solusi:**
1. **Update ke beta terbaru:**
   ```json
   { "plugin": ["opencode-ag-auth@beta"] }
   ```

2. **Disable MCP server** satu per satu untuk menemukan sumber masalah

3. **Tambahkan npm override:**
   ```json
   { "provider": { "google": { "npm": "@ai-sdk/google" } } }
   ```

---

### Error Akibat MCP Server

Beberapa MCP server memiliki schema yang tidak kompatibel dengan format JSON ketat Antigravity.

**Gejala umum:**
```bash
Invalid function name must start with a letter or underscore
```

Kadang muncul sebagai:
```bash
GenerateContentRequest.tools[0].function_declarations[12].name: Invalid function name must start with a letter or underscore
```

Biasanya ini berarti nama tool MCP diawali angka (misalnya key `1mcp_*`). Ubah key MCP agar diawali huruf (mis. `gw`) atau disable entri MCP tersebut untuk model Antigravity.

**Langkah diagnosis:**
1. Disable semua MCP server di config
2. Aktifkan satu per satu sampai error muncul lagi
3. Laporkan MCP terkait di [GitHub issue](https://github.com/tamaproject360/opencode-ag-auth/issues)

---

### "All Accounts Rate-Limited" (Padahal Quota Masih Ada)

**Penyebab:** Bug cascade pada `clearExpiredRateLimits()` di mode hybrid (sudah diperbaiki di beta terbaru).

**Solusi:**
1. Update ke versi beta terbaru
2. Jika masih terjadi, hapus file akun lalu login ulang
3. Coba ubah `account_selection_strategy` ke `"sticky"` di `antigravity.json`

---

### Session Recovery

Jika muncul error saat sesi berjalan:
1. Ketik `continue` untuk memicu mekanisme recovery
2. Jika masih blocked, pakai `/undo` untuk kembali ke state sebelum error
3. Coba ulang operasinya

---

### Penggunaan dengan Oh-My-OpenCode

**Penting:** Nonaktifkan built-in Google auth agar tidak konflik:

```json
// ~/.config/opencode/oh-my-opencode.json
{
  "google_auth": false,
  "agents": {
    "frontend-ui-ux-engineer": { "model": "google/gemini-3.1-pro" },
    "document-writer": { "model": "google/gemini-3-flash" },
    "multimodal-looker": { "model": "google/gemini-3-flash" }
  }
}
```

---

### File `.tmp` Terus Bertambah

**Penyebab:** Saat akun rate-limited dan plugin terus retry, file temp bisa menumpuk.

**Workaround:**
1. Stop OpenCode
2. Bersihkan: `rm ~/.config/opencode/*.tmp`
3. Tambah akun lain atau tunggu rate limit selesai

---

### Masalah OAuth Callback

<details>
<summary><b>Safari OAuth Callback Gagal (macOS)</b></summary>

**Gejala:**
- "fail to authorize" setelah login Google berhasil
- Safari menampilkan "Safari can't open the page"

**Penyebab:** Fitur "HTTPS-Only Mode" Safari memblokir callback `http://localhost`.

**Solusi:**

1. **Gunakan Chrome atau Firefox** (paling mudah):
   Salin URL OAuth lalu buka di browser lain.

2. **Nonaktifkan HTTPS-Only Mode sementara:**
   - Safari > Settings (⌘,) > Privacy
   - Uncheck "Enable HTTPS-Only Mode"
   - Jalankan `opencode auth login`
   - Aktifkan lagi setelah autentikasi selesai

</details>

<details>
<summary><b>Konflik Port (Address Already in Use)</b></summary>

**macOS / Linux:**
```bash
# Cari proses yang memakai port
lsof -i :51121

# Kill jika stale
kill -9 <PID>

# Coba lagi
opencode auth login
```

**Windows (PowerShell):**
```powershell
netstat -ano | findstr :51121
taskkill /PID <PID> /F
opencode auth login
```

</details>

<details>
<summary><b>Docker / WSL2 / Remote Development</b></summary>

OAuth callback membutuhkan browser bisa mengakses `localhost` pada mesin yang menjalankan OpenCode.

**WSL2:**
- Gunakan port forwarding di VS Code, atau
- Konfigurasikan forwarding Windows → WSL

**SSH / Remote:**
```bash
ssh -L 51121:localhost:51121 user@remote
```

**Docker / Containers:**
- OAuth dengan localhost redirect umumnya tidak jalan di container
- Tunggu 30 detik untuk alur URL manual, atau gunakan SSH port forwarding

</details>

---

### Typo Key Konfigurasi: `plugin` bukan `plugins`

Key yang benar adalah `plugin` (singular):

```json
{
  "plugin": ["opencode-ag-auth@beta"]
}
```

**Bukan** `"plugins"` (akan memicu error "Unrecognized key").

---

### Migrasi Akun Antar Mesin

Saat menyalin `antigravity-accounts.json` ke mesin baru:
1. Pastikan plugin terpasang: `"plugin": ["opencode-ag-auth@beta"]`
2. Salin `~/.config/opencode/antigravity-accounts.json`
3. Jika muncul error "API key missing", kemungkinan refresh token invalid — lakukan re-auth

## Interaksi Plugin yang Perlu Diperhatikan
Detail load balancing, dual quota pools, dan storage akun ada di [docs/MULTI-ACCOUNT.md](docs/MULTI-ACCOUNT.md).

---

## Kompatibilitas Plugin

### @tarquinen/opencode-dcp

DCP membuat synthetic assistant message tanpa thinking blocks. **Pastikan plugin ini berada SEBELUM DCP:**

```json
{
  "plugin": [
    "opencode-ag-auth@latest",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

### oh-my-opencode

Nonaktifkan built-in auth dan override model agent di `oh-my-opencode.json`:

```json
{
  "google_auth": false,
  "agents": {
    "frontend-ui-ux-engineer": { "model": "google/antigravity-gemini-3.1-pro" },
    "document-writer": { "model": "google/antigravity-gemini-3-flash" },
    "multimodal-looker": { "model": "google/antigravity-gemini-3-flash" }
  }
}
```

> **Tip:** Saat menjalankan subagent paralel, aktifkan `pid_offset_enabled: true` di `antigravity.json` agar distribusi sesi ke akun lebih merata.

### Plugin yang tidak perlu dipasang

- **gemini-auth plugins** — Tidak diperlukan. Plugin ini sudah menangani seluruh flow Google OAuth.

---

## Konfigurasi

Buat file `~/.config/opencode/antigravity.json` untuk pengaturan opsional:

```json
{
  "$schema": "https://raw.githubusercontent.com/tamaproject360/opencode-ag-auth/main/assets/antigravity.schema.json"
}
```

Mayoritas pengguna tidak perlu mengubah apa pun — default sudah memadai.

### Perilaku Model

| Option | Default | Fungsi |
|--------|---------|--------|
| `keep_thinking` | `false` | Menjaga thinking Claude lintas turn. **Peringatan:** mengaktifkan ini bisa menurunkan stabilitas model. |
| `session_recovery` | `true` | Recovery otomatis saat tool error |
| `cli_first` | `false` | Route model Gemini ke Gemini CLI terlebih dahulu (model Claude dan image tetap lewat Antigravity). |

### Rotasi Akun

| Setup Anda | Rekomendasi |
|------------|-------------|
| **1 account** | `"account_selection_strategy": "sticky"` |
| **2-5 accounts** | Default (`"hybrid"`) sudah optimal |
| **5+ accounts** | `"account_selection_strategy": "round-robin"` |
| **Parallel agents** | Tambahkan `"pid_offset_enabled": true` |

### Proteksi Quota

| Option | Default | Fungsi |
|--------|---------|--------|
| `soft_quota_threshold_percent` | `70` | Skip akun saat usage quota melewati persentase ini. Mencegah akun menyentuh batas penuh yang berisiko penalti. Set `100` untuk menonaktifkan. |
| `quota_refresh_interval_minutes` | `15` | Interval refresh quota di background. Setelah request sukses, cache quota akan direfresh jika sudah lebih tua dari interval ini. Set `0` untuk nonaktif. |
| `soft_quota_cache_ttl_minutes` | `"auto"` | Durasi cache quota dianggap fresh. `"auto"` = max(2 × refresh interval, 10 menit). Bisa diisi angka tetap (1-120). |

> **Cara kerja**: Cache quota direfresh otomatis setelah API request sukses (saat lebih tua dari `quota_refresh_interval_minutes`) dan manual via menu "Check quotas" di `opencode auth login`. Threshold check memakai `soft_quota_cache_ttl_minutes` untuk menilai freshness cache — jika cache sudah stale, akun dianggap "unknown" dan tetap diizinkan (fail-open). Jika SEMUA akun melewati threshold, plugin akan menunggu reset quota terdekat (mirip perilaku rate limit). Jika waktu tunggu melebihi `max_rate_limit_wait_seconds`, request akan gagal cepat.

### Scheduling Rate Limit

Kontrol bagaimana plugin menangani rate limit:

| Option | Default | Fungsi |
|--------|---------|--------|
| `scheduling_mode` | `"cache_first"` | `"cache_first"` = tunggu akun yang sama (menjaga prompt cache), `"balance"` = langsung switch, `"performance_first"` = round-robin |
| `max_cache_first_wait_seconds` | `60` | Waktu tunggu maksimum pada mode cache_first sebelum pindah akun |
| `failure_ttl_seconds` | `3600` | Reset failure count setelah durasi ini (mencegah penalti permanen akibat error lama) |

**Kapan pakai mode tertentu:**
- **cache_first** (default): terbaik untuk percakapan panjang; prompt cache lebih terjaga.
- **balance**: cocok untuk tugas cepat; switch akun segera saat kena rate limit.
- **performance_first**: cocok untuk banyak request pendek; distribusi beban lebih merata.

### Perilaku Aplikasi

| Option | Default | Fungsi |
|--------|---------|--------|
| `quiet_mode` | `false` | Sembunyikan notifikasi toast |
| `debug` | `false` | Aktifkan debug logging |
| `auto_update` | `true` | Auto-update plugin |

Untuk semua opsi, lihat [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

**Environment variables:**
```bash
OPENCODE_CONFIG_DIR=/path/to/config opencode  # Custom config directory
OPENCODE_ANTIGRAVITY_DEBUG=1 opencode         # Enable debug logging
OPENCODE_ANTIGRAVITY_DEBUG=2 opencode         # Verbose logging
```

---

## Troubleshooting

Lihat [Troubleshooting Guide](docs/TROUBLESHOOTING.md) untuk daftar solusi lengkap, termasuk:

- Masalah auth dan refresh token
- Error "Model not found"
- Session recovery
- Permission error di Gemini CLI
- OAuth issue di Safari
- Kompatibilitas plugin
- Panduan migrasi

---

## Dokumentasi

- [Configuration](docs/CONFIGURATION.md) — Semua opsi konfigurasi
- [Multi-Account](docs/MULTI-ACCOUNT.md) — Load balancing, dual quota pools, storage akun
- [Model Variants](docs/MODEL-VARIANTS.md) — Budget thinking dan sistem variant
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Masalah umum dan solusinya
- [Architecture](docs/ARCHITECTURE.md) — Cara kerja plugin
- [API Spec](docs/ANTIGRAVITY_API_SPEC.md) — Referensi API Antigravity

---

## Credits

Project ini dibangun di atas kontribusi para developer berikut:

- **[jenslys](https://github.com/jenslys)** - Creator asli [opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth) (fondasi auth Gemini CLI).
- **[NoeFabris](https://github.com/NoeFabris)** - Menambahkan dukungan Antigravity di [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) (dukungan multi-akun).
- **[Andy Vandaric](https://github.com/andyvandaric)** - **Enhanced Protection & Stability**:
  - **Strict Quota Protocol**: algoritma safety dengan threshold pemakaian **70%** (buffer aman 30%). Akun dikunci ketat sampai reset time spesifiknya lewat.
  - **Oh-My-OpenCode Integration**: session recovery penuh untuk crash tool dan error thinking block.
  - **Enterprise Feat**: dukungan proxy via `undici`.
  - **UX/Fixes**: interactive quota pause dan perbaikan header Cloud Code API.

## License

MIT License. Lihat [LICENSE](LICENSE) untuk detail.

<details>
<summary><b>Legal</b></summary>

### Intended Use

- Hanya untuk pengembangan personal / internal
- Tetap patuhi kebijakan quota dan penanganan data internal
- Bukan untuk layanan produksi atau bypass batasan yang berlaku

### Warning

Dengan menggunakan plugin ini, Anda memahami bahwa:

- **Risiko Terms of Service** — Pendekatan ini dapat melanggar ToS penyedia model AI
- **Risiko akun** — Penyedia dapat melakukan suspend atau ban akun
- **Tanpa jaminan** — API dapat berubah kapan saja tanpa pemberitahuan
- **Asumsi risiko** — Seluruh risiko hukum, finansial, dan teknis menjadi tanggung jawab pengguna

### Disclaimer

- Tidak berafiliasi dengan Google. Ini adalah proyek open-source independen.
- "Antigravity", "Gemini", "Google Cloud", dan "Google" adalah merek dagang milik Google LLC.

</details>
