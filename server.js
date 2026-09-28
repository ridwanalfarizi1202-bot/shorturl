import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { validUrl, validSlug, parseBatch } from './src/lib.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT = 3000, BUCKET = 'og-images' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env.example)');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newCode = () => crypto.randomBytes(5).toString('base64url').slice(0, 7);

// Uploads the OG image (if any) and returns its public URL.
async function storeImage(code, file) {
  if (!file) return null;
  const ext = EXT[file.mimetype];
  if (!ext) throw Object.assign(new Error('Format foto tidak didukung (JPG, PNG, WEBP, GIF).'), { status: 400 });
  const path = `${code}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Server error' });

// Per-visitor session id in a cookie, so each browser sees only its own links.
// Cookie rather than IP: behind cPanel/Passenger every visitor can share one
// source IP (req.ip becomes the proxy), so IP scoping would leak between users.
const SID_COOKIE = 'sid';
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const jar = Object.fromEntries((req.headers.cookie || '').split(';')
    .map(c => c.trim().split('=')).filter(p => p[0]));
  let sid = jar[SID_COOKIE];
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(sid || '')) {
    sid = crypto.randomBytes(16).toString('base64url');
    res.setHeader('Set-Cookie', `${SID_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure ? '; Secure' : ''}`);
  }
  req.sid = sid;
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.get('/', (_req, res) => res.sendFile(new URL('./views/index.html', import.meta.url).pathname));

app.get('/api/links', async (req, res) => {
  const { data, error } = await supabase.from('links')
    .select('code,title,description,image_url,clicks,created_at')
    .eq('owner', req.sid)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return fail(res, error);
  res.json(data);
});

app.post('/api/links', upload.single('image'), async (req, res) => {
  try {
    const targetUrl = String(req.body.targetUrl || '').trim();
    if (!validUrl(targetUrl)) return res.status(400).json({ error: 'URL harus dimulai http:// atau https://' });
    const custom = String(req.body.code || '').trim();
    if (custom && !validSlug(custom)) {
      return res.status(400).json({ error: 'Slug hanya boleh huruf, angka, - dan _' });
    }
    const code = custom || newCode();
    if (custom) {
      // Custom slug stays globally unique (URLs must resolve for everyone), so
      // another visitor's slug is still taken — that is the only cross-user clash.
      const { data: taken } = await supabase.from('links').select('code').eq('code', custom).maybeSingle();
      if (taken) return res.status(409).json({ error: `Slug "${custom}" sudah dipakai` });
    }
    const image_url = await storeImage(code, req.file);
    const { error } = await supabase.from('links').insert({
      code, target_url: targetUrl,
      title: String(req.body.title || '').trim(),
      description: String(req.body.description || '').trim(),
      image_url, owner: req.sid,
    });
    if (error) throw error;
    res.status(201).json({ code, shortUrl: `${req.protocol}://${req.get('host')}/${code}` });
  } catch (e) { fail(res, e); }
});

// One URL per line; optional "| title" after it. Blank lines skipped.
app.post('/api/batch', async (req, res) => {
  try {
    const { rows, skipped } = parseBatch(req.body.urls);
    const withCodes = rows.map(r => ({ ...r, code: newCode(), owner: req.sid }));
    if (withCodes.length) {
      const { error } = await supabase.from('links').insert(withCodes);
      if (error) throw error;
    }
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      created: withCodes.length,
      skipped,
      urls: withCodes.map(r => `${base}/${r.code}`),
    });
  } catch (e) { fail(res, e); }
});

app.get('/healthz', (_req, res) => res.send('ok'));

app.delete('/api/links/:code', async (req, res) => {
  const { code } = req.params;
  // Owner-scoped, and .select() tells us whether a row actually went. Without
  // this check a non-owner's request still ran the image cleanup below and
  // deleted someone else's OG image.
  const { data, error } = await supabase.from('links')
    .delete().eq('code', code).eq('owner', req.sid).select('code');
  if (error) return fail(res, error);
  if (!data.length) return res.status(404).json({ error: 'Link tidak ditemukan' });
  // Best-effort image cleanup: the stored name is "<code>.<ext>".
  const names = Object.values(EXT).map(ext => `${code}.${ext}`);
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(names);
  if (rmErr) console.error('image cleanup:', rmErr.message);
  res.json({ deleted: code });
});

// Short link: serve OG meta tags, then redirect. Must stay LAST (catch-all).
app.get('/:code', async (req, res) => {
  const { data: x, error } = await supabase.from('links')
    .select('target_url,title,description,image_url,clicks').eq('code', req.params.code).maybeSingle();
  if (error || !x) return res.status(404).send('Short URL tidak ditemukan');
  // ponytail: read-then-write counter, so no DB function needs creating. Two
  // concurrent clicks can lose one; for exact counting run bump_clicks() from
  // sql/schema.sql and use supabase.rpc('bump_clicks', { p_code: req.params.code }).
  supabase.from('links').update({ clicks: (x.clicks || 0) + 1 }).eq('code', req.params.code)
    .then(({ error: e }) => e && console.error('click counter:', e.message));
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('html').send(`<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta property="og:title" content="${esc(x.title)}">
<meta property="og:description" content="${esc(x.description)}">
<meta property="og:url" content="${base}/${esc(req.params.code)}">
<meta name="twitter:card" content="summary_large_image">
${x.image_url ? `<meta property="og:image" content="${esc(x.image_url)}">` : ''}
<meta http-equiv="refresh" content="0;url=${esc(x.target_url)}">
<title>${esc(x.title || x.target_url)}</title></head>
<body><p>Mengalihkan ke <a href="${esc(x.target_url)}">${esc(x.target_url)}</a>…</p>
<script>location.replace(${JSON.stringify(x.target_url)})</script></body></html>`);
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Foto maksimal 5 MB' });
  fail(res, err);
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
