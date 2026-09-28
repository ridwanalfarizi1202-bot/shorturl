# Short URLs — Node + Tailwind + Supabase

Stack: Express + Supabase (Postgres + Storage) + Tailwind CSS. No build step for the
server; Tailwind compiles one CSS file.

## 1. Supabase

1. Buat project di [supabase.com](https://supabase.com).
2. SQL Editor → New query → tempel isi `sql/schema.sql` → Run.
   (Fungsi `bump_clicks` opsional — app pakai update biasa kalau fungsi belum ada.)
3. Storage → New bucket → nama `og-images` → centang **Public bucket**.
4. Project Settings → API → salin **Project URL** dan **service_role key**.

## 2. Konfigurasi lokal

```bash
cp .env.example .env      # isi SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run build:css         # atau: npm run dev:css (watch saat ngoding)
npm start                 # http://localhost:3000
```

Tes logika murni (tanpa network): `node test/lib.test.js`

## 3. Deploy ke DomaiNesia Nimbus Go

Nimbus Go = cPanel + Node.js/NPM/PM2/SSH. Bukan serverless, jadi `vercel.json`/
`api/` **tidak dipakai** — aplikasi ini server Express biasa. Repo: GitHub
`ridwanalfarizi1202-bot/shorturl` (branch `main`).

**A. Tarik kode (pilih salah satu)**

- **Git Deploy Manager** (cPanel → *Git Version Control*): clone
  `https://github.com/ridwanalfarizi1202-bot/shorturl.git`, branch `main`.
- **SSH**: `git clone https://github.com/.../shorturl.git ~/shorturl`

**B. Buat aplikasi Node** — cPanel → **Setup Node.js App** → Create:

| Field | Isi |
|-------|-----|
| Node.js version | 18 atau lebih baru |
| Application root | folder hasil clone, mis. `shorturl` |
| Application URL | domain/subdomain kamu |
| Application startup file | `server.js` |

**C. Env & install** (SSH ke hosting):

```bash
cd ~/shorturl
cp .env.example .env && nano .env     # isi SUPABASE_URL + SERVICE_ROLE_KEY + BUCKET
npm install --omit=dev
```

`npm run build:css` **tidak wajib** di server — `public/style.css` sudah
di-commit. Jalankan hanya kalau kamu mengubah class Tailwind.

**D. Nyalakan** — kembali ke Setup Node.js App → **Run NPM Install** (kalau
belum) → **Restart**. Environment variable juga bisa diisi di form itu alih-alih
`.env`.

**E. SSL** — aktifkan AutoSSL cPanel supaya link jalan di `https://` (cookie
sesi otomatis dapat flag `Secure` saat https).

**Update berikutnya**: `git pull` lalu Restart app. Setiap kali `views/` atau
class Tailwind berubah: `npm run build:css` lalu Restart.

> Catatan Passenger: app harus *listen* di `PORT` dari environment — sudah
> begitu (`app.listen(PORT)`), jadi jangan hardcode port.

## Struktur

| File | Isi |
|------|-----|
| `server.js` | Semua route: `/`, `/api/links`, `/api/batch`, `/:code`, `/healthz` |
| `src/lib.js` | Helper murni: `validUrl`, `validSlug`, `parseBatch` |
| `src/input.css` | Sumber Tailwind + komponen (glass, field, tab) |
| `views/index.html` | Markup halaman (2 tab: Single & Batch) |
| `public/app.js` | Fetch + render, drag & drop gambar |
| `sql/schema.sql` | Tabel `links` + fungsi `bump_clicks` |

## Isolasi per pengunjung (session)

Setiap browser dapat cookie `sid` (random, HttpOnly) dan hanya melihat/menghapus
link yang `owner`-nya sama. Jadi short-an orang lain tidak muncul di list kamu.

- Sesi berbasis **cookie**, bukan IP: di belakang cPanel/Passenger semua
  pengunjung bisa berbagi satu IP, sehingga scoping per-IP akan bocor.
- Short link-nya sendiri tetap publik (siapa pun yang punya URL bisa membuka).
- **Custom slug tetap unik global** — URL harus bisa dibuka semua orang, jadi
  slug milik orang lain tetap "sudah dipakai". Slug acak tidak akan bentrok.
- Hapus link Anda = hilang dari list Anda, tapi kalau link itu masih diakses,
  orang tetap sampai ke tujuan sampai baris-nya benar-benar dihapus (memang
  dihapus dari DB, jadi 404).
