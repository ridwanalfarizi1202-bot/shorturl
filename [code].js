import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const code = req.query.code;
  const { data: x, error } = await supabase.from('links').select('*').eq('code', code).single();
  if (error || !x) return res.status(404).send('Short URL tidak ditemukan');
  await supabase.from('links').update({ clicks: (x.clicks || 0) + 1 }).eq('code', code);
  const esc = s => String(s || '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta property="og:title" content="${esc(x.title)}"><meta property="og:description" content="${esc(x.description)}">${x.image_url ? `<meta property="og:image" content="${esc(x.image_url)}">` : ''}<meta http-equiv="refresh" content="0;url=${esc(x.target_url)}"><title>${esc(x.title)}</title></head><body><p>Mengalihkan...</p><script>location.replace(${JSON.stringify(x.target_url)})</script></body></html>`);
}
