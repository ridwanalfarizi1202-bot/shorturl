import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const validUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } };

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const { data, error } = await supabase.from('links').select('code,title,clicks,image_url').order('created_at', { ascending: false }).limit(30);
      if (error) return json({ error: error.message }, 500);
      return json(data.map(x => ({ code: x.code, title: x.title, clicks: x.clicks, imageUrl: x.image_url })));
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const form = await request.formData();
    const targetUrl = String(form.get('targetUrl') || '').trim();
    if (!validUrl(targetUrl)) return json({ error: 'URL harus dimulai http:// atau https://' }, 400);
    const code = crypto.randomBytes(5).toString('base64url').slice(0, 7);
    const image = form.get('image');
    let imageUrl = null;
    if (image instanceof File && image.size) {
      if (image.size > 5 * 1024 * 1024) return json({ error: 'Foto maksimal 5 MB' }, 400);
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[image.type];
      if (!ext) return json({ error: 'Format foto tidak didukung' }, 400);
      const path = `og/${code}.${ext}`;
      const upload = await supabase.storage.from('og-images').upload(path, Buffer.from(await image.arrayBuffer()), { contentType: image.type, upsert: true });
      if (upload.error) return json({ error: upload.error.message }, 500);
      imageUrl = supabase.storage.from('og-images').getPublicUrl(path).data.publicUrl;
    }
    const { error } = await supabase.from('links').insert({ code, target_url: targetUrl, title: String(form.get('title') || 'Short URL').trim(), description: String(form.get('description') || '').trim(), image_url: imageUrl });
    if (error) return json({ error: error.message }, 500);
    return json({ code, shortUrl: new URL(`/${code}`, request.url).href }, 201);
  } catch (error) { return json({ error: error.message || 'Server error' }, 500); }
}
