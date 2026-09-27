import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const base = req => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
const validUrl = x => { try { const u = new URL(x); return ['http:','https:'].includes(u.protocol); } catch { return false; } };

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('links').select('code,title,clicks,image_url').order('created_at', { ascending: false }).limit(30);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data.map(x => ({ code: x.code, title: x.title, clicks: x.clicks, imageUrl: x.image_url })));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const form = await req.formData();
  const targetUrl = String(form.get('targetUrl') || '');
  if (!validUrl(targetUrl)) return res.status(400).json({ error: 'URL harus dimulai http:// atau https://' });
  const code = crypto.randomBytes(5).toString('base64url').slice(0, 7);
  const image = form.get('image');
  let imageUrl = null;
  if (image && image.size) {
    if (image.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'Foto maksimal 5 MB' });
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[image.type];
    if (!ext) return res.status(400).json({ error: 'Format foto tidak didukung' });
    const path = `og/${code}.${ext}`;
    const upload = await supabase.storage.from('og-images').upload(path, Buffer.from(await image.arrayBuffer()), { contentType: image.type, upsert: true });
    if (upload.error) return res.status(500).json({ error: upload.error.message });
    imageUrl = supabase.storage.from('og-images').getPublicUrl(path).data.publicUrl;
  }
  const { error } = await supabase.from('links').insert({ code, target_url: targetUrl, title: String(form.get('title') || 'Short URL'), description: String(form.get('description') || ''), image_url: imageUrl });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ code, shortUrl: `${base(req)}/${code}` });
}
