# Task List — opencode-auth-ag-new

> **Gap Analysis & Development Roadmap**
> Dibuat: 21 Februari 2026 | Versi saat ini: **1.6.0**

---

## Ringkasan Gap Analysis

### Status Keseluruhan

| Dimensi | Status | Detail |
|---------|--------|--------|
| Build & Typecheck | ✅ Lulus | `tsc --noEmit` bersih, tidak ada error |
| Unit Tests | ✅ 905/930 lulus | 28 file test, 25 `todo` belum diimplementasi |
| Test Coverage | ⚠️ 36.23% | Banyak modul kritis belum tercakup |
| Dokumentasi | ⚠️ Sebagian ketinggalan zaman | ARCHITECTURE.md tidak mencerminkan struktur file aktual |
| Code Quality | ⚠️ Ada inkonsistensi | Path, duplikasi, referensi usang |

---

## Temuan Gap Kritis

### 1. Coverage Test Sangat Rendah pada Modul Kritis

| Modul | Coverage Baris | Risiko |
|-------|---------------|--------|
| `quota.ts` | **2.61%** | Tinggi — logika quota rotation tidak teruji |
| `search.ts` | **2.92%** | Tinggi — Google Search grounding tidak teruji |
| `server.ts` | **3.22%** | Tinggi — OAuth callback server tidak teruji |
| `cli.ts` | **3.20%** | Tinggi — login menu tidak teruji |
| `errors.ts` | **6.06%** | Tinggi — error types tidak teruji |
| `project.ts` | **7.14%** | Tinggi — project context resolution tidak teruji |
| `thinking-recovery.ts` | **9.37%** | Tinggi — turn boundary detection tidak teruji |
| `image-saver.ts` | **10.2%** | Sedang — image saving tidak teruji |
| `recovery.ts` | **18.55%** | Tinggi — session recovery kritis, sangat sedikit test |
| `cache/signature-cache.ts` | **2.72%** | Tinggi — disk-based cache tidak teruji |
| `recovery/storage.ts` | **7.06%** | Tinggi — session storage tidak teruji |
| `auth-menu.ts` | **1.78%** | Sedang — UI auth menu tidak teruji |

### 2. Inkonsistensi & Bug Potensial

- **`auto_resume` default bertentangan**: `schema.ts` line 160 mendefinisikan `.default(false)` namun `DEFAULT_CONFIG` (line 464) menetapkan `auto_resume: true`.
- **`version.ts` sengaja dinonaktifkan**: `initAntigravityVersion()` dipaksa ke fallback tanpa mengambil versi aktual dari API. Dapat menyebabkan error "version no longer supported" jika fallback usang.
- **Path `image-saver.ts` tidak konsisten**: Menyimpan ke `~/.opencode/generated-images/` sementara semua modul lain menggunakan `~/.config/opencode/`.
- **`getWarmupAttemptCount()` tidak berfungsi**: Fungsi selalu mengembalikan `1` atau `0` — tidak pernah increment, sehingga logika retry warmup tidak bekerja benar.
- **Duplikasi `createThoughtBuffer()`**: Dua implementasi identik di `src/plugin/stores/signature-store.ts` dan `src/plugin/core/streaming/transformer.ts`.

### 3. Referensi Usang & Technical Debt

- **`config/updater.ts`** masih menggunakan nama repo lama `"opencode-auth-ag-new"` di 3 tempat (line 49, 58, 188). Harus diupdate ke `"opencode-auth-ag-new"`.
- **`docs/ARCHITECTURE.md`** (terakhir diperbarui Desember 2025): Tidak mencantumkan modul-modul baru seperti `transform/`, `core/streaming/`, `config/`, `stores/`, `ui/`, `recovery/`, `hooks/`.
- **`request-helpers.ts` line 14**: `TODO: Update to Antigravity link if available` untuk `ANTIGRAVITY_PREVIEW_LINK` masih menggunakan URL Gemini generik.
- **`scripts/check-quota.mjs`**: Mengandung `FALLBACK_PROJECT_ID = "bamboo-precept-lgxtn"` yang hardcoded — kemungkinan project ID pribadi/sensitif.

### 4. Modul Tanpa Test Sama Sekali

- `src/antigravity/oauth.ts` — Alur OAuth PKCE tidak ada test sama sekali
- `src/plugin.ts` (main entry) — Fetch interceptor utama tidak ada unit test
- `src/plugin/fingerprint.ts` — Fingerprint generation tidak ada test
- `src/plugin/debug.ts` — Logger tidak ada test
- `src/plugin/proxy.ts` — Proxy configuration tidak ada test

### 5. Test `todo` yang Belum Diimplementasi (25 items)

Semua ada di `persist-account-pool.test.ts` — test untuk merge account, deduplication, error handling saat file tidak dapat dibaca, dan TUI flow belum ditulis.

### 6. Celah Fungsional

- **Context Overflow Guard** (v1.6.0): Token estimator menggunakan heuristic sederhana, belum ada test coverage untuk edge case (misalnya: message dengan banyak tool calls, pesan yang sangat panjang).
- **Auto-Compact Integration**: Alur `/compact` command belum diuji secara otomatis — hanya manual/E2E.
- **Streaming transformer**: Coverage 52.47% — kasus edge inline image, signature dedup, dan `usageMetadata` injection belum tercakup.
- **`config/loader.ts`**: Coverage 69.65%, branch coverage hanya 45.83% — banyak code path config loading belum diuji.

---

## Task List

### Phase 1 — Stabilisasi & Bug Fix Kritis

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 1 | Fix inkonsistensi `auto_resume` default: selaraskan antara `schema.ts` (`.default(false)`) dan `DEFAULT_CONFIG` (`auto_resume: true`) | Selesai | Kritis | 1 |
| 2 | Fix path `image-saver.ts`: ganti `~/.opencode/generated-images/` menjadi `~/.config/opencode/generated-images/` agar konsisten | Selesai | Tinggi | 1 |
| 3 | Fix `getWarmupAttemptCount()` di `plugin.ts`: implementasikan counter yang benar menggunakan `Map<string, number>` alih-alih Set | Selesai | Tinggi | 1 |
| 4 | Hapus duplikasi `createThoughtBuffer()`: hapus dari `stores/signature-store.ts`, ekspor hanya dari `core/streaming/transformer.ts` | Selesai | Sedang | 1 |
| 5 | ~~Update referensi nama repo~~ — `config/updater.ts` sudah benar menggunakan `"opencode-auth-ag-new"`. Selesai saat audit dokumentasi. | Selesai | Sedang | 1 |
| 6 | Dokumentasikan mengapa `initAntigravityVersion()` sengaja dinonaktifkan: tambah komentar lengkap di `version.ts` beserta instruksi re-enable | Selesai | Sedang | 1 |
| 7 | Audit dan sanitasi `scripts/check-quota.mjs`: hapus `FALLBACK_PROJECT_ID = "bamboo-precept-lgxtn"` hardcoded, fallback ke string kosong | Selesai | Tinggi | 1 |

### Phase 2 — Test Coverage Modul Kritis

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 8 | Tulis unit test untuk `src/plugin/quota.ts`: mock quota API, test quota fraction calculation, test rotation trigger saat low quota | Selesai | Kritis | 2 |
| 9 | Tulis unit test untuk `src/antigravity/oauth.ts`: test PKCE flow, token exchange, refresh token parsing, project provisioning | Selesai | Kritis | 2 |
| 10 | Tulis unit test untuk `src/plugin/thinking-recovery.ts`: test tool loop detection, synthetic message injection, compacted turn detection | Selesai | Kritis | 2 |
| 11 | Tulis unit test untuk `src/plugin/recovery.ts`: test `tool_result_missing`, `thinking_block_order`, `thinking_disabled_violation` recovery path | Selesai | Kritis | 2 |
| 12 | Tulis unit test untuk `src/plugin/project.ts`: test project resolution, `loadCodeAssist`, `onboardUser` provisioning, promise dedup cache | Selesai | Tinggi | 2 |
| 13 | Tulis unit test untuk `src/plugin/fingerprint.ts`: test fingerprint generation, platform variance, history management (max 5), persistensi | Selesai | Tinggi | 2 |
| 14 | Tulis unit test untuk `src/plugin/cache/signature-cache.ts`: test disk read/write, TTL expiry, atomic write, background cleanup | Selesai | Tinggi | 2 |
| 15 | Tulis unit test untuk `src/plugin/recovery/storage.ts`: test pembacaan session OpenCode, thinking block recovery, empty message recovery | Selesai | Tinggi | 2 |
| 16 | Implementasikan 25 `it.todo()` di `persist-account-pool.test.ts`: merge account, dedup, error saat file unreadable, TUI flow | Selesai | Sedang | 2 |
| 17 | Tingkatkan coverage `src/plugin/request.ts` dari 45% ke >70%: test edge case context overflow, warmup path, model-specific handling | Selesai | Tinggi | 2 |
| 18 | Tingkatkan coverage `src/plugin/core/streaming/transformer.ts` dari 52% ke >75%: test inline image handling, signature dedup, usageMetadata injection | Selesai | Sedang | 2 |

### Phase 3 — Test Coverage Modul Pendukung

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 19 | Tulis unit test untuk `src/plugin/search.ts`: test Google Search grounding flow, non-streaming fallback, error handling | Selesai | Tinggi | 3 |
| 20 | Tulis unit test untuk `src/plugin/server.ts`: test OAuth callback server, environment detection (OrbStack/WSL/SSH), success page | Selesai | Sedang | 3 |
| 21 | Tulis unit test untuk `src/plugin/errors.ts`: test semua custom error types dan metadata | Selesai | Sedang | 3 |
| 22 | Tulis unit test untuk `src/plugin/proxy.ts`: test env variable precedence (HTTPS_PROXY, HTTP_PROXY, dll.), fallback ketika tidak ada proxy | Selesai | Rendah | 3 |
| 23 | Tulis unit test untuk `src/plugin/debug.ts`: test file-based logging, log level filtering, redaksi data sensitif | Selesai | Rendah | 3 |
| 24 | Tingkatkan coverage `src/plugin/config/loader.ts` dari 69% ke >85%: test semua branch path config loading | Selesai | Sedang | 3 |
| 25 | Tingkatkan coverage `src/plugin/accounts.ts` dari 75% ke >90%: test skenario rotation edge case, failure TTL, capacity backoff | Selesai | Sedang | 3 |
| 26 | Tingkatkan coverage `src/plugin/request-helpers.ts` dari 64% ke >80%: test semua 7 fase schema cleaning pipeline | Selesai | Sedang | 3 |

### Phase 4 — Dokumentasi & Developer Experience

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 27 | Update `docs/ARCHITECTURE.md`: tambahkan semua modul baru (`transform/`, `core/streaming/`, `config/`, `stores/`, `ui/`, `recovery/`, `hooks/`), selaraskan dengan struktur aktual | Belum | Tinggi | 4 |
| 28 | Update `AGENTS.md`: tambahkan deskripsi modul-modul baru yang belum terdaftar di bagian Module Structure | Belum | Sedang | 4 |
| 29 | Update `docs/TROUBLESHOOTING.md`: tambahkan seksi untuk context overflow, auto-compact, dan Gemini 3.1 model issues (belum ada coverage untuk v1.6.0 features) | Belum | Sedang | 4 |
| 30 | Update `ANTIGRAVITY_PREVIEW_LINK` di `request-helpers.ts` line 14: resolusi TODO dengan URL yang benar atau hapus jika tidak relevan | Belum | Rendah | 4 |
| 31 | Tambahkan inline JSDoc ke `src/plugin/accounts.ts` untuk 3 strategi seleksi (sticky, round-robin, hybrid) — kompleksitas tinggi tanpa dokumentasi kode | Belum | Rendah | 4 |
| 32 | Buat `docs/STREAMING.md`: dokumentasikan alur SSE streaming transformer, thought buffer, signature caching dari response | Belum | Rendah | 4 |

### Phase 5 — Refaktor & Technical Debt

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 33 | Refaktor `src/plugin.ts` (4930 baris): ekstrak logika warmup, verification probe, dan toast management ke modul terpisah | Belum | Sedang | 5 |
| 34 | Refaktor `src/plugin/request.ts` (1846 baris): pisahkan request builder dari response transformer agar lebih mudah diuji | Belum | Sedang | 5 |
| 35 | Refaktor `src/plugin/request-helpers.ts` (2832 baris): pisahkan schema cleaning pipeline, thinking filter, dan tool pairing ke file terpisah | Belum | Rendah | 5 |
| 36 | Aktifkan kembali `version.ts` fetching: implementasikan `initAntigravityVersion()` yang benar-benar mengambil versi dari API dengan retry dan timeout | Belum | Rendah | 5 |
| 37 | Tambahkan CI pipeline (GitHub Actions): jalankan `typecheck` + `vitest run` + `build` otomatis pada setiap PR | Belum | Tinggi | 5 |
| 38 | Tambahkan coverage gate di CI: gagalkan PR jika coverage turun di bawah threshold yang ditetapkan (target: 50% global) | Belum | Sedang | 5 |

### Phase 6 — Fitur Baru & Enhancement

| No | Tugas | Status | Prioritas | Phase |
|----|-------|--------|-----------|-------|
| 39 | Implementasikan token estimator yang lebih akurat untuk context overflow guard: gunakan tiktoken atau estimasi per-model yang lebih presisi | Belum | Sedang | 6 |
| 40 | Tambahkan E2E test otomatis untuk auto-compact flow: verifikasi bahwa overflow guard memicu `/compact` dan recovery berjalan benar | Belum | Sedang | 6 |
| 41 | Implementasikan retry eksponensial di `quota.ts` untuk quota API calls yang gagal: saat ini tidak ada retry | Belum | Sedang | 6 |
| 42 | Tambahkan metrics/telemetry internal (opsional, opt-in): track success rate per model, rata-rata latensi, quota exhaustion frequency | Belum | Rendah | 6 |
| 43 | Tambahkan dukungan untuk Gemini 3.2 jika tersedia: update model allowlist dan resolver ketika model baru dirilis | Belum | Rendah | 6 |
| 44 | Implementasikan graceful shutdown: pastikan atomic file write di `storage.ts` selesai sebelum proses di-kill (handle SIGTERM/SIGINT) | Belum | Sedang | 6 |

---

## Ringkasan Statistik

| Phase | Jumlah Task | Kritis | Tinggi | Sedang | Rendah |
|-------|-------------|--------|--------|--------|--------|
| Phase 1 — Bug Fix | 7 | 1 | 3 | 3 | 0 |
| Phase 2 — Test Kritis | 11 | 4 | 5 | 2 | 0 |
| Phase 3 — Test Pendukung | 8 | 0 | 3 | 4 | 1 |
| Phase 4 — Dokumentasi | 6 | 0 | 1 | 3 | 2 |
| Phase 5 — Refaktor | 6 | 0 | 1 | 3 | 2 |
| Phase 6 — Fitur Baru | 6 | 0 | 0 | 4 | 2 |
| **Total** | **44** | **5** | **13** | **19** | **7** |

---

## Urutan Rekomendasi Pengerjaan

```
Phase 1 (Bug Fix) → Phase 2 (Test Kritis) → Phase 5 (CI/CD)
       ↓
Phase 3 (Test Pendukung) → Phase 4 (Dokumentasi)
       ↓
Phase 6 (Fitur Baru)
```

> **Prioritas utama**: Selesaikan Phase 1 dan task CI/CD (no. 37) sebelum lanjut ke Phase 2,
> agar setiap fix dapat divalidasi secara otomatis dan tidak ada regresi.

---

*Dokumen ini dibuat secara otomatis dari hasil gap analysis pada 21 Februari 2026.*
*Update dokumen ini setiap kali task selesai dikerjakan.*
