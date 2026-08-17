/* ============================================================
   CATÁLOGO VIRTUAL — helpers comuns (vitrine + admin)
   ============================================================ */
'use strict';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtBR = (n) => (n == null ? '' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

async function api(url, opts = {}) {
  const noReload = opts.noReload;
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (r.status === 401) {
    if (!noReload) location.reload();
    throw new Error('Não autorizado');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || ('Erro ' + r.status));
  return data;
}

async function apiUpload(url, file) {
  const fd = new FormData();
  fd.append('arquivo', file);
  const r = await fetch(url, { method: 'POST', body: fd });
  if (r.status === 401) { location.reload(); throw new Error('Não autorizado'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || ('Erro ' + r.status));
  return data;
}