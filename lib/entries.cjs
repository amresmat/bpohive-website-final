// Private copy of every form entry and every unfinished form, kept in the project's
// Upstash Redis database (Vercel > Storage). Nothing here is ever public: the data lives
// in the database, not in the code. If the database is not connected yet, saving is skipped
// quietly and the forms keep working exactly as before.
const crypto = require('node:crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEEP_DAYS = 400;
const MAX_ENTRIES = 50000;

const configured = () => Boolean(URL_ && TOKEN);

async function pipe(commands) {
  if (!configured()) return null;
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error('Database returned ' + r.status);
  return (await r.json()).map(x => x.result);
}

const clean = (v, n = 1000) => (v == null ? '' : String(v).slice(0, n));
const digits = v => clean(v, 60).replace(/\D/g, '');
const emailOf = v => { const e = clean(v, 200).trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; };

// Keep only plain, short values and never anything that looks like a secret.
function tidy(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {}).slice(0, 40)) {
    if (/pass|card|cvv|cvc|ssn|token|secret|companyfax|honeypot/i.test(k)) continue;
    if (v == null || typeof v === 'object') continue;
    const s = clean(v, 2000).trim();
    if (s) out[clean(k, 60)] = s;
  }
  return out;
}

// A finished submission. Also marks any unfinished form from the same person as completed.
async function saveEntry(form, fields, meta = {}) {
  try {
    if (!configured()) return;
    const f = tidy(fields);
    const rec = { id: crypto.randomUUID(), form: clean(form, 80), at: new Date().toISOString(), page: clean(meta.page, 500), referrer: clean(meta.referrer, 500), fields: f };
    const email = emailOf(f.email || f.work_email || f.businessEmail), phone = digits(f.phone || f.phone_number);
    const lookups = [];
    if (email) lookups.push(['GET', 'draftmail:' + email]);
    if (phone.length >= 7) lookups.push(['GET', 'draftphone:' + phone]);
    if (meta.draftId && /^[a-z0-9]{12,40}$/i.test(meta.draftId)) lookups.push(['ECHO', meta.draftId]);
    const results = await pipe([['LPUSH', 'entries', JSON.stringify(rec)], ['LTRIM', 'entries', 0, MAX_ENTRIES - 1], ...lookups]);
    const ids = [...new Set((results || []).slice(2).filter(Boolean))];
    if (ids.length) await pipe(ids.map(id => ['SADD', 'drafts:done', id]));
  } catch (e) {
    console.error('Entry not saved to database:', e.message);
  }
}

// An unfinished form, updated as the visitor types.
async function saveDraft(id, form, fields, meta = {}) {
  if (!configured()) return false;
  const f = tidy(fields);
  if (!Object.keys(f).length) return false;
  const now = Date.now();
  const key = 'draft:' + id;
  const [prev] = await pipe([['GET', key]]);
  let first = now;
  try { if (prev) first = JSON.parse(prev).first || now; } catch {}
  const rec = { id, form: clean(form, 80), page: clean(meta.page, 500), referrer: clean(meta.referrer, 500), first, updated: now, fields: f };
  const ttl = KEEP_DAYS * 86400;
  const cmds = [['SET', key, JSON.stringify(rec), 'EX', ttl], ['ZADD', 'drafts', now, id]];
  const email = emailOf(f.email || f.work_email || f.businessEmail), phone = digits(f.phone || f.phone_number);
  if (email) cmds.push(['SET', 'draftmail:' + email, id, 'EX', ttl]);
  if (phone.length >= 7) cmds.push(['SET', 'draftphone:' + phone, id, 'EX', ttl]);
  await pipe(cmds);
  return true;
}

async function listEntries(limit = 2000) {
  const [rows] = await pipe([['LRANGE', 'entries', 0, limit - 1]]);
  return (rows || []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

// Unfinished forms: not completed, and untouched for at least 2 minutes.
async function listAbandoned(limit = 2000) {
  const [ids, done] = await pipe([['ZREVRANGE', 'drafts', 0, limit - 1], ['SMEMBERS', 'drafts:done']]);
  if (!ids || !ids.length) return [];
  const finished = new Set(done || []);
  const open = ids.filter(id => !finished.has(id));
  if (!open.length) return [];
  const [rows] = await pipe([['MGET', ...open.map(id => 'draft:' + id)]]);
  const cutoff = Date.now() - 2 * 60 * 1000;
  return (rows || []).map(r => { try { return JSON.parse(r); } catch { return null; } })
    .filter(d => d && d.updated < cutoff);
}

// Removes one finished entry or one unfinished form, by its id.
async function removeItem(view, id) {
  if (!/^[a-z0-9-]{12,40}$/i.test(String(id))) return false;
  if (view === 'abandoned') {
    const [n] = await pipe([['DEL', 'draft:' + id], ['ZREM', 'drafts', id]]);
    return n > 0;
  }
  const [rows] = await pipe([['LRANGE', 'entries', 0, MAX_ENTRIES - 1]]);
  const raw = (rows || []).find(r => { try { return JSON.parse(r).id === id; } catch { return false; } });
  if (!raw) return false;
  await pipe([['LREM', 'entries', 1, raw]]);
  return true;
}

module.exports = { configured, pipe, saveEntry, saveDraft, listEntries, listAbandoned, removeItem };
