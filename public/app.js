const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const banner = $('#banner'), list = $('#links');
const showBanner = (text, ok) => {
  banner.textContent = text;
  banner.className = 'mb-4 rounded-xl border px-4 py-3 backdrop-blur ' + (ok
    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50'
    : 'border-red-500/60 bg-red-500/20 text-red-50');
  banner.hidden = false;
  banner.focus();
};
const clearBanner = () => { banner.hidden = true; };

// Copy to clipboard. navigator.clipboard needs a secure context (https or
// localhost) and permission; fall back to a hidden textarea + execCommand.
async function copy(text, btn) {
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  };
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text); ok = true;
    } else ok = legacy();
  } catch { ok = legacy(); }
  if (btn) {
    const t = btn.textContent;
    btn.textContent = ok ? 'Tersalin!' : 'Gagal salin';
    setTimeout(() => { btn.textContent = t; }, 1500);
  }
}

// Success popup: native <dialog> gives focus trap, ESC and backdrop for free.
const modal = $('#modal'), modalBody = $('#modalBody'), modalNote = $('#modalNote');
function showResult(title, urls, note = '') {
  modal.querySelector('h2').textContent = title;
  modalBody.innerHTML = urls.map(u => `<div class="flex items-center gap-2">
    <input class="field font-mono text-sm" readonly value="${esc(u)}" onclick="this.select()">
    <button type="button" data-copy="${esc(u)}"
      class="shrink-0 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Salin</button>
  </div>`).join('');
  modalNote.textContent = note; modalNote.hidden = !note;
  modalBody.querySelectorAll('[data-copy]').forEach(b =>
    b.addEventListener('click', () => copy(b.dataset.copy, b)));
  modal.showModal();
}

async function load() {
  try {
    const rows = await (await fetch('/api/links')).json();
    list.innerHTML = rows.length ? rows.map(x => `<li class="glass flex items-start gap-4 p-4">
      ${x.image_url ? `<img src="${esc(x.image_url)}" alt="" loading="lazy" class="h-16 w-16 flex-none rounded-lg object-cover">` : ''}
      <div class="min-w-0 flex-1">
        <b>${esc(x.title || '(no title)')}</b>
        <p class="my-1 text-sm text-slate-400">${esc(x.description)}</p>
        <a class="text-emerald-300" href="/${encodeURIComponent(x.code)}">/${esc(x.code)}</a>
        <code class="block break-all text-xs text-slate-400">${esc(x.target_url)} · ${x.clicks || 0} klik</code>
        <div class="mt-2 flex gap-2">
          <button type="button" data-copy="${esc(location.origin + '/' + x.code)}"
            class="rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Salin</button>
          <button type="button" data-del="${esc(x.code)}"
            class="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-100 transition hover:bg-red-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Hapus</button>
        </div>
      </div></li>`).join('') : '<li class="glass p-4 text-slate-400">Belum ada link.</li>';
  } catch {
    list.innerHTML = '<li class="glass p-4 text-slate-400">Gagal memuat link.</li>';
  }
}

// Copy + delete for every card, via delegation (one listener, not one per row).
list.addEventListener('click', async e => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) return copy(copyBtn.dataset.copy, copyBtn);

  const delBtn = e.target.closest('[data-del]');
  if (!delBtn) return;
  const code = delBtn.dataset.del;
  if (!confirm(`Hapus link /${code}?`)) return;
  delBtn.disabled = true; delBtn.textContent = 'Menghapus…';
  try {
    const r = await fetch(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || 'Gagal menghapus');
    await load();
  } catch (err) {
    showBanner(err.message, false);
    delBtn.disabled = false; delBtn.textContent = 'Hapus';
  }
});

// A submit handler shared by both forms: disable button, POST, report, reload.
function wire(form, url, payload, done) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyimpan…'; clearBanner();
    try {
      const r = await fetch(url, { method: 'POST', body: payload(form) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Gagal menyimpan');
      form.reset(); resetHint();
      done(data);
      await load();
    } catch (err) {
      showBanner(err.message, false);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
}

wire($('#single'), '/api/links', f => new FormData(f),
  d => showResult('Link dibuat', [d.shortUrl]));
wire($('#batch'), '/api/batch', f => new URLSearchParams(new FormData(f)),
  d => showResult(`Dibuat ${d.created} link`,
    d.urls,
    d.skipped.length ? `Dilewati (URL tidak valid): ${d.skipped.join(', ')}` : ''));

// Drag & drop + filename hint for the image input.
const input = $('#image'), drop = $('#drop'), hint = $('#hint');
const DEFAULT_HINT = hint.textContent;
const resetHint = () => { hint.textContent = DEFAULT_HINT; drop.classList.remove('border-emerald-400', 'bg-emerald-500/10'); };
input.addEventListener('change', () => { hint.textContent = input.files[0]?.name || DEFAULT_HINT; });
['dragover', 'dragleave', 'drop'].forEach(type => drop.addEventListener(type, e => {
  e.preventDefault();
  drop.classList.toggle('border-emerald-400', type === 'dragover');
  drop.classList.toggle('bg-emerald-500/10', type === 'dragover');
  if (type === 'drop' && e.dataTransfer.files[0]) {
    input.files = e.dataTransfer.files;
    hint.textContent = e.dataTransfer.files[0].name;
  }
}));

load();
