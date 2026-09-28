// Pure helpers, kept separate so they can be tested without Supabase.
export const validUrl = value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

export const validSlug = s => /^[A-Za-z0-9_-]+$/.test(s);

// "url | optional title" per line; blank lines skipped, invalid URLs collected.
export function parseBatch(text) {
  const rows = [], skipped = [];
  for (const line of String(text || '').split('\n')) {
    const [rawUrl, ...rest] = line.split('|');
    const targetUrl = rawUrl.trim();
    if (!targetUrl) continue;
    if (!validUrl(targetUrl)) { skipped.push(targetUrl); continue; }
    rows.push({ target_url: targetUrl, title: rest.join('|').trim() });
  }
  return { rows, skipped };
}
