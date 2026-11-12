// Salesfinity "Meeting Set" calls (read with SALESFINITY_API_KEY, Settings -> Connections -> API keys).
// Leads booked through Calendly often have no Lead Entry Form row, so no recording. For those, the
// Pipeline shows the Salesfinity call that set the meeting: the recording link and a short summary.
// Calls are kept in Redis hash pl:sf (field = Salesfinity call id); pl:sf:state remembers the last sync.
const { pipe } = require('./entries.cjs');

let _pipe = pipe;
let _fetch = (...a) => fetch(...a);
const P = cmds => _pipe(cmds);
const API = 'https://client-api.salesfinity.co';
const MEETING_SET = 1;               // Salesfinity's disposition id for "Meeting Set"
const BACKFILL_DAYS = 180;
const EVERY_MS = 10 * 60 * 1000;     // sync at most every 10 minutes
const keyOf = () => process.env.SALESFINITY_API_KEY || '';
const on = () => Boolean(keyOf());

const str = (v, n = 300) => (v == null ? '' : String(v)).trim().slice(0, n);
const parseJSON = s => { try { return JSON.parse(s); } catch { return null; } };
const phoneKey = v => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
const slug = v => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function slim(c) {
  const ct = c.contact || {}, u = c.user || {};
  const id = str(c._id || c.call_id, 64);
  return {
    id, at: c.started_at || c.createdAt || '', rep: [u.first_name, u.last_name].filter(Boolean).join(' '),
    name: [ct.first_name, ct.last_name].filter(Boolean).join(' '), email: str(ct.email, 160).toLowerCase(), company: str(ct.company, 160), title: str(ct.title, 120),
    phones: [...new Set([c.to, (ct.phone_numbers || []).map(p => p && p.number)].flat().map(phoneKey).filter(Boolean))],
    recording: /^https?:\/\//.test(c.recording_url || '') ? c.recording_url : '', duration: Number(c.duration) || 0,
    summary: str(c.summary, 2000), transcript: str(c.transcription, 20000), disposition: str(c.disposition && c.disposition.external_name, 60),
    link: id ? 'https://web.salesfinity.co/call-detail/' + id : ''
  };
}

async function get(path) {
  const r = await _fetch(API + path, { headers: { 'x-api-key': keyOf(), Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Salesfinity returned ' + r.status + (r.status === 403 ? ' (check the API key)' : ''));
  return r.json();
}

// Pulls "Meeting Set" calls created since the last sync (first time: the last 180 days).
async function sync({ force = false, budgetMs = 8000 } = {}) {
  if (!on()) return { skipped: true };
  const [raw] = await P([['GET', 'pl:sf:state']]);
  const st = parseJSON(raw) || {};
  if (!force && st.at && Date.now() - st.at < EVERY_MS) return { skipped: true, fresh: true };
  const since = new Date(st.lastAt ? Date.parse(st.lastAt) - 2 * 864e5 : Date.now() - BACKFILL_DAYS * 864e5).toISOString();
  const until = Date.now() + budgetMs;
  let page = 1, saved = 0, newest = st.lastAt || '', pages = 1, error = '';
  try {
    do {
      const q = '/v1/call-log?limit=100&page=' + page + '&filters[disposition_ids][]=' + MEETING_SET + '&filters[start_date]=' + encodeURIComponent(since);
      const j = await get(q);
      const rows = (j.data || []).map(slim).filter(c => c.id);
      if (rows.length) await P([['HSET', 'pl:sf', ...rows.flatMap(c => [c.id, JSON.stringify(c)])]]);
      rows.forEach(c => { if (c.at > newest) newest = c.at; });
      saved += rows.length;
      pages = Number((j.pagination || {}).pages) || (rows.length === 100 ? page + 1 : page);
      page++;
    } while (page <= pages && page <= 30 && Date.now() < until);
  } catch (e) { error = e.message; }
  await P([['SET', 'pl:sf:state', JSON.stringify({ at: Date.now(), lastAt: page > pages ? newest : st.lastAt || '', error, saved })]]);
  return { saved, error };
}

async function all() {
  const [raw] = await P([['HGETALL', 'pl:sf']]);
  const out = []; for (let i = 0; i < (raw || []).length; i += 2) { const v = parseJSON(raw[i + 1]); if (v) out.push(v); }
  return out;
}
async function one(id) { const [raw] = await P([['HGET', 'pl:sf', String(id)]]); return parseJSON(raw); }

// Adds sfCalls to Calendly-booked leads that have no recording from the Lead Entry Form.
// Matched by email, then phone, then full name (only when one Salesfinity contact has that name).
function attach(leads, meetings, calls) {
  if (!calls.length) return;
  const byEmail = new Map(), byPhone = new Map(), byName = new Map();
  const add = (m, k, c) => { if (!k) return; const a = m.get(k) || []; a.push(c); m.set(k, a); };
  calls.forEach(c => { add(byEmail, c.email, c); c.phones.forEach(p => add(byPhone, p, c)); add(byName, slug(c.name).includes(' ') ? slug(c.name) : '', c); });
  const calendly = new Set(meetings.filter(m => (m.kind || 'calendly') === 'calendly').map(m => m.id));
  leads.forEach(l => {
    if (!(l.meetings || []).some(id => calendly.has(id))) return;
    if ((l.sheetRows || []).some(r => /^https?:\/\//.test(r.recording || ''))) return;
    let found = (l.email && byEmail.get(String(l.email).toLowerCase())) || (phoneKey(l.phone) && byPhone.get(phoneKey(l.phone))) || null;
    if (!found) { const n = byName.get(slug(l.name)); if (n && new Set(n.map(c => c.email || c.phones[0] || c.id)).size === 1) found = n; }
    if (!found) return;
    l.sfCalls = found.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3)
      .map(c => ({ id: c.id, at: c.at, rep: c.rep, recording: c.recording, link: c.link, duration: c.duration, hasText: Boolean(c.transcript || c.summary) }));
  });
}

module.exports = { on, sync, all, one, attach, slim, MEETING_SET, _setPipe: f => { _pipe = f; }, _setFetch: f => { _fetch = f; } };
