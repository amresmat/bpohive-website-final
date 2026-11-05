// Pipeline: one place for every BPO Hive lead and meeting.
//   Inbound  = website forms (already saved by lib/entries.cjs)
//   Outbound = the callers' "Hot Leads" Google Sheets (pushed here every 15 minutes by a small
//              Google Apps Script, see scripts/pipeline-sheets-sync.gs)
//   Meetings = Calendly (read with CALENDLY_TOKEN, a Calendly personal access token)
// Showed / No-show / Rescheduled / Cancelled is marked with one click in the admin; a no-show
// is also flagged in Calendly. Everything is kept in the same Upstash Redis as the form entries.
const crypto = require('node:crypto');
const { configured, pipe, listEntries } = require('./entries.cjs');

const CAL = 'https://api.calendly.com';
const BACKFILL_DAYS = 180;          // first Calendly sync reaches this far back
const RESCAN_PAST_DAYS = 45;        // every sync re-reads this window to catch cancellations / no-shows
const RESCAN_FUTURE_DAYS = 120;
const STALE_MS = 3 * 60 * 1000;     // the admin page re-syncs Calendly if older than this
const INVITEE_FETCHES_PER_RUN = 40;
const OUTCOMES = ['showed', 'no_show', 'rescheduled', 'cancelled'];
const STAGES = ['won', 'lost'];
const SKIP_FORMS = /calendly booking/i; // used only to enrich, not a lead of its own
const ALLOWED_SYNC_EMAILS = () => String(process.env.PIPELINE_SHEETS_EMAILS || 'amr@bpohive.com,info@bpohive.com,abdullah@bpohive.com').toLowerCase().split(/[,\s]+/).filter(Boolean);

let _pipe = pipe;
const P = cmds => _pipe(cmds);
const calendlyOn = () => Boolean(process.env.CALENDLY_TOKEN);
const clean = (v, n = 500) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const emailIn = v => { const m = String(v || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? m[0] : ''; };
const slug = v => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const uuidOf = uri => String(uri || '').split('/').pop();
const parseJSON = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/* ---------------- Calendly ---------------- */
async function cal(path, opt = {}) {
  const r = await fetch(path.startsWith('http') ? path : CAL + path, {
    method: opt.method || 'GET',
    headers: { Authorization: 'Bearer ' + process.env.CALENDLY_TOKEN, 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    signal: AbortSignal.timeout(8000)
  });
  const t = await r.text();
  const j = parseJSON(t) || {};
  if (!r.ok) { const e = new Error(j.message || j.title || ('Calendly ' + r.status)); e.status = r.status; throw e; }
  return j;
}

async function calendlyScope() {
  const [cached] = await P([['GET', 'pl:cal:scope']]);
  const c = parseJSON(cached);
  if (c && c.user) return c;
  const me = await cal('/users/me');
  const scope = { user: me.resource.uri, org: me.resource.current_organization, name: me.resource.name || '' };
  await P([['SET', 'pl:cal:scope', JSON.stringify(scope)]]);
  return scope;
}

async function listEvents(scope, minStart, maxStart, deadline) {
  const out = [];
  const q = (who) => `/scheduled_events?${who}&min_start_time=${encodeURIComponent(new Date(minStart).toISOString())}&max_start_time=${encodeURIComponent(new Date(maxStart).toISOString())}&count=100&sort=start_time:asc`;
  let next = null, first = true, who = 'organization=' + encodeURIComponent(scope.org);
  while ((first || next) && Date.now() < deadline) {
    let j;
    try { j = await cal(first ? q(who) : next); }
    catch (e) {
      // Not an organization admin: fall back to the token owner's own events.
      if (first && (e.status === 403 || e.status === 400) && who.startsWith('organization')) { who = 'user=' + encodeURIComponent(scope.user); continue; }
      throw e;
    }
    out.push(...(j.collection || []));
    next = j.pagination && j.pagination.next_page; first = false;
  }
  return out;
}

function slimInvitee(i) {
  const qa = (i.questions_and_answers || []).map(x => ({ q: clean(x.question, 200), a: clean(x.answer, 600) }));
  const t = i.tracking || {};
  return {
    uri: i.uri, name: clean(i.name, 160), email: emailIn(i.email), status: i.status, created: i.created_at,
    noShow: i.no_show ? i.no_show.uri : null, rescheduled: Boolean(i.rescheduled), newInvitee: i.new_invitee || null,
    cancelReason: i.cancellation ? clean(i.cancellation.reason, 300) : '', canceledBy: i.cancellation ? clean(i.cancellation.canceler_type, 40) : '',
    phone: clean(i.text_reminder_number, 40), qa,
    utm: { source: clean(t.utm_source, 80), medium: clean(t.utm_medium, 80), campaign: clean(t.utm_campaign, 120) }
  };
}

// Pulls new and changed Calendly meetings into Redis. Time-boxed so a page load never hangs.
async function syncCalendly({ force = false, budgetMs = 7000 } = {}) {
  if (!calendlyOn() || !configured()) return { skipped: true };
  const deadline = Date.now() + budgetMs;
  const [stateRaw, lock] = await P([['GET', 'pl:cal:state'], ['SET', 'pl:cal:lock', '1', 'NX', 'EX', 60]]);
  const state = parseJSON(stateRaw) || {};
  if (!lock) return { skipped: true, busy: true };
  if (!force && state.at && Date.now() - state.at < STALE_MS) { await P([['DEL', 'pl:cal:lock']]); return { skipped: true, fresh: true }; }
  const now = Date.now();
  try {
    const scope = await calendlyScope();
    const from = state.backfilled ? now - RESCAN_PAST_DAYS * 864e5 : now - BACKFILL_DAYS * 864e5;
    const events = await listEvents(scope, from, now + RESCAN_FUTURE_DAYS * 864e5, deadline - 1500);
    const ids = events.map(e => uuidOf(e.uri));
    const stored = ids.length ? await P([['MGET', ...ids.map(id => 'pl:m:' + id)]]).then(r => r[0]) : [];
    const queue = [];
    events.forEach((e, k) => {
      const prev = parseJSON(stored[k]);
      const end = Date.parse(e.end_time);
      const stale = !prev || prev.updated !== e.updated_at || !prev.invitees ||
        (end < now && end > now - 3 * 864e5 && (!prev.checked || now - prev.checked > 30 * 60e3)); // recent: pick up no-shows marked in Calendly
      const rec = Object.assign(prev || {}, {
        id: uuidOf(e.uri), uri: e.uri, name: clean(e.name, 160), start: e.start_time, end: e.end_time, status: e.status,
        created: e.created_at, updated: e.updated_at, host: clean(((e.event_memberships || [])[0] || {}).user_name, 80),
        location: clean((e.location || {}).type, 60)
      });
      queue.push({ rec, stale: stale ? (prev ? 1 : 2) : 0 });
    });
    queue.sort((a, b) => b.stale - a.stale);
    let fetched = 0;
    for (const item of queue) {
      if (!item.stale || fetched >= INVITEE_FETCHES_PER_RUN || Date.now() > deadline - 800) break;
      try {
        const j = await cal(`/scheduled_events/${item.rec.id}/invitees?count=20`);
        item.rec.invitees = (j.collection || []).map(slimInvitee);
        item.rec.checked = Date.now(); fetched++;
      } catch (e) { item.rec.error = clean(e.message, 200); }
    }
    const cmds = [];
    queue.forEach(({ rec }) => { cmds.push(['SET', 'pl:m:' + rec.id, JSON.stringify(rec)], ['ZADD', 'pl:m', String(Date.parse(rec.start)), rec.id]); });
    const pending = queue.filter(q => q.stale && !q.rec.invitees).length;
    const next = { at: Date.now(), backfilled: state.backfilled || (pending === 0 && Date.now() < deadline), events: events.length, fetched, pending, error: '' };
    cmds.push(['SET', 'pl:cal:state', JSON.stringify(next)], ['DEL', 'pl:cal:lock']);
    for (let i = 0; i < cmds.length; i += 400) await P(cmds.slice(i, i + 400));
    return next;
  } catch (e) {
    await P([['SET', 'pl:cal:state', JSON.stringify(Object.assign(state, { at: Date.now(), error: clean(e.message, 200) }))], ['DEL', 'pl:cal:lock']]);
    return { error: e.message };
  }
}

/* ---------------- Fathom (call recordings) ---------------- */
// Read with FATHOM_API_KEY (Fathom → Settings → API Access). The key sees the owner's recordings plus
// calls shared with them or their team. A recording where the prospect actually spoke marks the
// matching Calendly meeting as "Showed" automatically (unless someone marked it by hand).
const FATHOM = 'https://api.fathom.ai/external/v1';
const FATHOM_STALE_MS = 10 * 60 * 1000;
const FATHOM_PAGES_PER_RUN = 8;
const fathomOn = () => Boolean(process.env.FATHOM_API_KEY);
async function fathom(path) {
  const r = await fetch(FATHOM + path, { headers: { 'X-Api-Key': process.env.FATHOM_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  const t = await r.text(); const j = parseJSON(t) || {};
  if (!r.ok) { const e = new Error(j.message || j.error || ('Fathom ' + r.status)); e.status = r.status; throw e; }
  return j;
}
function slimRecording(r) {
  const inv = (r.calendar_invitees || []).map(i => ({ name: clean(i.name, 120), email: emailIn(i.email), external: Boolean(i.is_external) }));
  const tr = Array.isArray(r.transcript) ? r.transcript : [];
  const speakers = [...new Set(tr.map(x => clean(x.speaker && x.speaker.display_name, 120)).filter(Boolean))];
  const spokeEmails = new Set(tr.map(x => emailIn(x.speaker && x.speaker.matched_calendar_invitee_email)).filter(Boolean));
  const ext = inv.filter(i => i.external);
  const internal = new Set(inv.filter(i => !i.external).map(i => slug(i.name)).concat(slug(r.recorded_by && r.recorded_by.name)).filter(Boolean));
  const extNames = new Set(ext.map(i => slug(i.name)).filter(Boolean));
  const externalSpoke = ext.some(i => i.email && spokeEmails.has(i.email)) || speakers.some(n => extNames.has(slug(n))) ||
    (ext.length > 0 && speakers.some(n => !internal.has(slug(n)) && !/^speaker\s*\d*$/i.test(n)));
  const summary = r.default_summary && r.default_summary.markdown_formatted ? String(r.default_summary.markdown_formatted).slice(0, 6000) : '';
  const actions = (Array.isArray(r.action_items) ? r.action_items : []).map(a => clean(typeof a === 'string' ? a : (a.description || a.text || ''), 300)).filter(Boolean).slice(0, 15);
  return {
    id: String(r.recording_id || r.id || ''), title: clean(r.meeting_title || r.title, 200), start: r.recording_start_time || r.scheduled_start_time || r.created_at,
    end: r.recording_end_time || r.scheduled_end_time || '', scheduled: r.scheduled_start_time || '', created: r.created_at,
    url: r.share_url || r.url || '', recordedBy: clean(r.recorded_by && r.recorded_by.name, 120), invitees: inv, speakers: speakers.slice(0, 12), externalSpoke, summary, actions
  };
}
async function syncFathom({ force = false, budgetMs = 6000 } = {}) {
  if (!fathomOn() || !configured()) return { skipped: true };
  const deadline = Date.now() + budgetMs;
  const [stateRaw, lock] = await P([['GET', 'pl:fa:state'], ['SET', 'pl:fa:lock', '1', 'NX', 'EX', 60]]);
  const state = parseJSON(stateRaw) || {};
  if (!lock) return { skipped: true, busy: true };
  if (!force && !state.cursor && state.at && Date.now() - state.at < FATHOM_STALE_MS) { await P([['DEL', 'pl:fa:lock']]); return { skipped: true, fresh: true }; }
  try {
    const runAfter = state.cursor ? state.runAfter : (state.after ? state.after - 864e5 : Date.now() - BACKFILL_DAYS * 864e5);
    let cursor = state.cursor || null, pages = 0, saved = 0, maxSeen = state.maxSeen || 0;
    do {
      const q = '/meetings?created_after=' + encodeURIComponent(new Date(runAfter).toISOString()) + '&calendar_invitees_domains_type=one_or_more_external&include_summary=true&include_transcript=true&include_action_items=true' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const j = await fathom(q);
      const recs = (j.items || []).map(slimRecording).filter(x => x.id);
      const cmds = [];
      recs.forEach(x => { cmds.push(['SET', 'pl:f:' + x.id, JSON.stringify(x)], ['ZADD', 'pl:f', String(Date.parse(x.start) || 0), x.id]); maxSeen = Math.max(maxSeen, Date.parse(x.created) || 0); });
      if (cmds.length) await P(cmds);
      saved += recs.length; pages++; cursor = j.next_cursor || null;
    } while (cursor && pages < FATHOM_PAGES_PER_RUN && Date.now() < deadline - 1500);
    const next = cursor
      ? { at: Date.now(), cursor, runAfter, maxSeen, after: state.after || 0, backfilled: Boolean(state.backfilled), error: '' }
      : { at: Date.now(), cursor: null, after: Math.max(maxSeen, state.after || 0) || Date.now(), maxSeen: 0, backfilled: true, error: '' };
    await P([['SET', 'pl:fa:state', JSON.stringify(next)], ['DEL', 'pl:fa:lock']]);
    return Object.assign({ saved, pages }, next);
  } catch (e) {
    await P([['SET', 'pl:fa:state', JSON.stringify(Object.assign(state, { at: Date.now(), error: clean(e.message, 200) }))], ['DEL', 'pl:fa:lock']]);
    return { error: e.message };
  }
}

/* ---------------- Google Sheets (outbound) ---------------- */
// The Apps Script signs each push with the Google account's identity token (an OpenID JWT).
// We check Google's signature and that the account is one of ours, so no password or key is needed.
let certCache = null;
async function googleCerts() {
  if (certCache && certCache.exp > Date.now()) return certCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) });
  const j = await r.json();
  certCache = { keys: j.keys || [], exp: Date.now() + 3600e3 };
  return certCache.keys;
}
const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyGoogleToken(token, certs) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('No token');
  const header = JSON.parse(b64u(parts[0]).toString()), claims = JSON.parse(b64u(parts[1]).toString());
  const keys = certs || await googleCerts();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new Error('Unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64u(parts[2]));
  if (!ok) throw new Error('Bad signature');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('Wrong issuer');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60e3) throw new Error('Token expired');
  const email = String(claims.email || '').toLowerCase();
  if (!claims.email_verified || !ALLOWED_SYNC_EMAILS().includes(email)) throw new Error('Account not allowed: ' + email);
  return email;
}

function callerFromTitle(title) {
  const m = String(title || '').match(/hot leads\s*(?:internal sales\s*)?(.+)$/i);
  return m ? clean(m[1], 60) : clean(title, 60);
}
const HEAD = {
  at: /^(timestamp|date|date added|created)/i, name: /^(name|full name|contact|contact name|prospect)$/i, title: /^(title|job title|position|role)$/i,
  company: /^(company|company name|account|business)$/i, campaign: /^(campaign|list)$/i, update: /^(latest update|status|call outcome|outcome|last update)$/i,
  trail: /^(update trail|history|notes|comments)$/i, phone: /^(number|phone|phone number|mobile|contact info)$/i, email: /^(email|e-mail|work email)$/i
};
function readTab(values) {
  const rows = (values || []).filter(r => Array.isArray(r));
  const hi = rows.findIndex(r => r.some(c => HEAD.name.test(clean(c))) && r.some(c => HEAD.company.test(clean(c))));
  if (hi < 0) return [];
  const map = {};
  rows[hi].forEach((c, i) => { for (const [k, re] of Object.entries(HEAD)) if (map[k] == null && re.test(clean(c))) map[k] = i; });
  return rows.slice(hi + 1).map(r => {
    const g = k => (map[k] == null ? '' : clean(r[map[k]], k === 'trail' ? 3000 : 500));
    const name = g('name'), company = g('company');
    if (!name && !company) return null;
    const email = emailIn(g('email')) || emailIn(g('phone')) || emailIn(r.join(' '));
    const phone = /\d{6,}/.test(g('phone').replace(/\D/g, '')) && !emailIn(g('phone')) ? g('phone') : '';
    return { at: g('at'), name, title: g('title'), company, campaign: g('campaign'), update: g('update'), trail: g('trail'), phone, email };
  }).filter(Boolean);
}

async function saveSheets(body, email) {
  const sheets = Array.isArray(body && body.sheets) ? body.sheets.slice(0, 40) : [];
  const byFile = {};
  sheets.forEach(s => {
    const id = clean(s.id, 80); if (!/^[\w-]{20,80}$/.test(id)) return;
    const f = byFile[id] || (byFile[id] = { id, title: clean(s.title, 120), caller: callerFromTitle(s.title), rows: [], tabs: [], error: '' });
    if (s.error) { f.error = clean(s.error, 200); return; }
    const rows = readTab((s.rows || []).slice(0, 5000));
    if (rows.length) f.tabs.push(clean(s.tab, 80));
    rows.forEach(r => f.rows.push(Object.assign(r, { tab: clean(s.tab, 80) })));
  });
  const files = Object.values(byFile);
  const at = Date.now();
  const cmds = [];
  files.forEach(f => { f.syncedAt = at; f.by = email; cmds.push(['SET', 'pl:sheet:' + f.id, JSON.stringify(f)], ['SADD', 'pl:sheets', f.id]); });
  cmds.push(['SET', 'pl:sheets:at', String(at)]);
  await P(cmds);
  return { files: files.map(f => ({ title: f.title, caller: f.caller, rows: f.rows.length, error: f.error })) };
}

/* ---------------- Merge everything into leads ---------------- */
function effectiveOutcome(m, now = Date.now()) {
  const ov = m.override;
  if (ov && OUTCOMES.includes(ov.outcome)) return ov.outcome;
  const inv = (m.invitees || [])[0] || {};
  if (m.status === 'canceled') return inv.rescheduled ? 'rescheduled' : 'cancelled';
  if (inv.noShow) return 'no_show';
  if (m.fathomSpoke) return 'showed';
  if (Date.parse(m.end) < now) return 'needs';
  return 'upcoming';
}

function websiteLead(e) {
  const f = e.fields || {};
  const name = clean(f.name || [f.firstName, f.lastName].filter(Boolean).join(' '), 160);
  return {
    at: e.at, name, email: emailIn(f.email || f.work_email), phone: clean(f.phone, 40), company: clean(f.company || f.brokerage || f.website, 160),
    title: clean(f.jobTitle || f.role, 120), campaign: /real estate/i.test(e.form) ? 'Real estate recruiting' : 'Website', detail: f, page: e.page, id: e.id
  };
}

async function load() {
  const [mIds, sheetIds, sheetsAt, calState, ovRaw, leadOvRaw, fIds, faState] = await P([
    ['ZRANGE', 'pl:m', 0, -1], ['SMEMBERS', 'pl:sheets'], ['GET', 'pl:sheets:at'], ['GET', 'pl:cal:state'], ['HGETALL', 'pl:outcomes'], ['HGETALL', 'pl:leadov'], ['ZRANGE', 'pl:f', 0, -1], ['GET', 'pl:fa:state']
  ]);
  const [fRaw] = fIds && fIds.length ? await P([['MGET', ...fIds.map(id => 'pl:f:' + id)]]) : [[]];
  const [mRaw] = mIds && mIds.length ? await P([['MGET', ...mIds.map(id => 'pl:m:' + id)]]) : [[]];
  const [sRaw] = sheetIds && sheetIds.length ? await P([['MGET', ...sheetIds.map(id => 'pl:sheet:' + id)]]) : [[]];
  const hash = a => { const o = {}; for (let i = 0; i < (a || []).length; i += 2) o[a[i]] = parseJSON(a[i + 1]); return o; };
  const outcomes = hash(ovRaw), leadOv = hash(leadOvRaw);
  const meetings = (mRaw || []).map(parseJSON).filter(Boolean).map(m => Object.assign(m, { override: outcomes[m.id] || null }));
  const sheets = (sRaw || []).map(parseJSON).filter(Boolean);
  const entries = await listEntries(3000);
  const recordings = (fRaw || []).map(parseJSON).filter(Boolean);
  return { meetings, sheets, entries, leadOv, recordings, sheetsAt: Number(sheetsAt) || 0, calState: parseJSON(calState) || {}, faState: parseJSON(faState) || {} };
}

function build(data, now = Date.now()) {
  const leads = new Map(), byEmail = new Map(), byName = new Map();
  const keyFor = (email, name, company) => email ? 'e:' + email : 'n:' + slug(name) + '|' + slug(company);
  function find(email, name) {
    if (email && byEmail.has(email)) return byEmail.get(email);
    const n = slug(name);
    if (n && n.includes(' ') && byName.has(n)) return byName.get(n);
    return null;
  }
  function add(kind, rec) {
    let L = find(rec.email, rec.name);
    if (!L) {
      L = { key: keyFor(rec.email, rec.name, rec.company), name: '', email: '', phone: '', company: '', title: '', firstAt: null, sources: [], campaigns: [], callers: [], updates: [], meetings: [], website: [], sheetRows: [], recordings: [] };
      leads.set(L.key, L);
    }
    ['name', 'email', 'phone', 'company', 'title'].forEach(k => { if (!L[k] && rec[k]) L[k] = rec[k]; });
    if (L.email) byEmail.set(L.email, L);
    const n = slug(L.name); if (n && n.includes(' ') && !byName.has(n)) byName.set(n, L);
    const t = Date.parse(rec.at);
    if (!isNaN(t) && (!L.firstAt || t < L.firstAt)) { L.firstAt = t; L.firstKind = kind; }
    if (!L.sources.includes(kind)) L.sources.push(kind);
    if (rec.campaign && !L.campaigns.includes(rec.campaign)) L.campaigns.push(rec.campaign);
    return L;
  }
  // 1. Website (inbound)
  const enrich = [];
  data.entries.forEach(e => {
    if (SKIP_FORMS.test(e.form)) { enrich.push(e); return; }
    const w = websiteLead(e); if (!w.email && !w.name) return;
    const L = add('website', w); L.website.push({ at: e.at, form: e.form, page: e.page, fields: w.detail, id: e.id });
  });
  // 2. Sheets (outbound)
  data.sheets.forEach(s => (s.rows || []).forEach(r => {
    const L = add('sheet', r);
    if (s.caller && !L.callers.includes(s.caller)) L.callers.push(s.caller);
    L.sheetRows.push({ sheet: s.title, caller: s.caller, at: r.at, update: r.update, trail: r.trail, campaign: r.campaign });
    if (r.update) L.updates.push({ at: r.at, text: r.update, by: s.caller });
  }));
  // 3. Calendly meetings
  data.meetings.forEach(m => {
    const inv = (m.invitees || [])[0];
    if (!inv) return;
    const company = (inv.qa.find(x => /company|business|organi[sz]ation|brokerage/i.test(x.q)) || {}).a || '';
    const L = add('calendly', { at: inv.created || m.created, name: inv.name, email: inv.email, company, phone: inv.phone });
    m.leadKey = L.key;
    L.meetings.push(m.id);
  });
  // 4. Fathom recordings: attach to the lead (by the prospect's email or name) and to the Calendly meeting it belongs to
  const mById0 = new Map(data.meetings.map(m => [m.id, m]));
  let unlinked = 0;
  (data.recordings || []).forEach(r => {
    const ext = (r.invitees || []).filter(i => i.external);
    let L = null;
    for (const i of ext) { L = find(i.email, i.name); if (L) break; }
    if (!L) { unlinked++; return; }
    L.recordings.push(r);
    const t0 = Date.parse(r.scheduled || r.start);
    const m = L.meetings.map(id => mById0.get(id)).filter(Boolean).find(x => Math.abs(Date.parse(x.start) - t0) <= 2 * 3600e3);
    if (m) { m.fathom = { id: r.id, url: r.url, title: r.title }; if (r.externalSpoke) m.fathomSpoke = true; }
  });
  data.meetings.forEach(m => { m.outcome = effectiveOutcome(m, now); });
  enrich.forEach(e => { const L = byEmail.get(emailIn(e.fields && e.fields.email)); if (L && !L.company && e.fields.company) L.company = clean(e.fields.company, 160); });

  const mById = new Map(data.meetings.map(m => [m.id, m]));
  const out = [...leads.values()].map(L => {
    const ov = data.leadOv[L.key] || {};
    const ms = L.meetings.map(id => mById.get(id)).filter(Boolean).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const type = ov.type || (L.firstKind === 'sheet' ? 'outbound' : L.firstKind === 'website' ? 'inbound' : (L.sources.includes('sheet') ? 'outbound' : 'inbound'));
    let stage = 'new';
    if (L.sources.includes('sheet') && L.updates.length) stage = 'working';
    const outs = ms.map(m => m.outcome);
    if (outs.includes('upcoming')) stage = 'booked';
    else if (outs.includes('showed')) stage = 'showed';
    else if (outs.includes('needs')) stage = 'needs';
    else if (outs.includes('no_show')) stage = 'no_show';
    else if (outs.length && outs.every(o => o === 'cancelled' || o === 'rescheduled')) stage = 'cancelled';
    if (stage !== 'booked' && stage !== 'showed' && L.recordings.some(r => r.externalSpoke && (!ms.length || Date.parse(r.start) > Date.parse(ms[ms.length - 1].start) - 2 * 3600e3))) stage = 'showed';
    if (STAGES.includes(ov.stage)) stage = ov.stage;
    const next = ms.find(m => m.outcome === 'upcoming');
    const last = [...ms].reverse().find(m => m.outcome !== 'upcoming');
    const latest = L.updates.slice(-1)[0];
    return {
      key: L.key, name: L.name, email: L.email, phone: L.phone, company: L.company, title: L.title, type, stage,
      firstAt: L.firstAt, sources: L.sources, campaigns: L.campaigns, callers: L.callers,
      latest: latest ? latest.text : (L.website[0] ? 'Sent the ' + L.website[0].form + ' form' : ''),
      next: next ? next.start : null, lastMeeting: last ? { start: last.start, outcome: last.outcome } : null,
      meetings: ms.map(m => m.id), website: L.website, sheetRows: L.sheetRows, note: ov.note || '', stageOverride: ov.stage || '', typeOverride: ov.type || '',
      recordings: L.recordings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).map(r => ({ id: r.id, title: r.title, start: r.start, url: r.url, recordedBy: r.recordedBy, spoke: r.externalSpoke, summary: r.summary, actions: r.actions }))
    };
  }).sort((a, b) => (b.firstAt || 0) - (a.firstAt || 0));
  const meetings = data.meetings.map(m => {
    const inv = (m.invitees || [])[0] || {};
    const L = leads.get(m.leadKey);
    const lead = L ? out.find(x => x.key === L.key) : null;
    return {
      id: m.id, name: m.name, start: m.start, end: m.end, status: m.status, created: m.created, host: m.host,
      invitee: { name: inv.name || '', email: inv.email || '', phone: inv.phone || '', qa: inv.qa || [], cancelReason: inv.cancelReason || '', utm: inv.utm || {} },
      outcome: m.outcome || effectiveOutcome(m, now), auto: !m.override, noShowInCalendly: Boolean(inv.noShow), fathom: m.fathom || null, viaFathom: Boolean(!m.override && m.fathomSpoke && m.outcome === 'showed'),
      leadKey: m.leadKey || null, company: lead ? lead.company : '', type: lead ? lead.type : 'inbound', callers: lead ? lead.callers : [], campaigns: lead ? lead.campaigns : []
    };
  }).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return { leads: out, meetings, unlinked };
}

async function snapshot({ sync = true } = {}) {
  let calSync = null;
  if (sync) [calSync] = await Promise.all([calendlyOn() ? syncCalendly() : null, fathomOn() ? syncFathom() : null]);
  const data = await load();
  const { leads, meetings, unlinked } = build(data);
  return {
    leads, meetings,
    status: {
      calendly: { connected: calendlyOn(), lastSync: data.calState.at || 0, error: data.calState.error || '', events: data.calState.events || 0, backfilled: Boolean(data.calState.backfilled), justRan: Boolean(calSync && !calSync.skipped) },
      sheets: { lastSync: data.sheetsAt, files: data.sheets.map(s => ({ title: s.title, caller: s.caller, rows: (s.rows || []).length, syncedAt: s.syncedAt, error: s.error || '' })) },
      fathom: { connected: fathomOn(), lastSync: data.faState.at || 0, error: data.faState.error || '', recordings: (data.recordings || []).length, unlinked, backfilled: Boolean(data.faState.backfilled) },
      website: { entries: data.entries.length }
    }
  };
}

/* ---------------- Admin actions ---------------- */
async function setOutcome(id, outcome) {
  if (!/^[\w-]{2,64}$/.test(String(id))) throw new Error('Unknown meeting');
  const [raw] = await P([['GET', 'pl:m:' + id]]);
  const m = parseJSON(raw); if (!m) throw new Error('Unknown meeting');
  const inv = (m.invitees || [])[0];
  let calendly = '';
  if (outcome === 'clear') { await P([['HDEL', 'pl:outcomes', id]]); return { ok: true }; }
  if (!OUTCOMES.includes(outcome)) throw new Error('Unknown outcome');
  // Keep Calendly's own no-show flag in step with what the team marks here.
  if (calendlyOn() && inv && inv.uri) {
    try {
      if (outcome === 'no_show' && !inv.noShow) { const j = await cal('/invitee_no_shows', { method: 'POST', body: { invitee: inv.uri } }); inv.noShow = j.resource && j.resource.uri; calendly = 'marked'; }
      if (outcome === 'showed' && inv.noShow) { await cal(inv.noShow, { method: 'DELETE' }).catch(e => { if (e.status !== 404) throw e; }); inv.noShow = null; calendly = 'cleared'; }
    } catch (e) { calendly = 'failed: ' + clean(e.message, 120); }
  }
  await P([['HSET', 'pl:outcomes', id, JSON.stringify({ outcome, at: Date.now() })], ['SET', 'pl:m:' + id, JSON.stringify(m)]]);
  return { ok: true, calendly };
}

async function setLead(key, patch) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  const [raw] = await P([['HGET', 'pl:leadov', key]]);
  const cur = parseJSON(raw) || {};
  if (patch.stage !== undefined) { if (patch.stage && !STAGES.includes(patch.stage)) throw new Error('Unknown stage'); cur.stage = patch.stage || ''; }
  if (patch.type !== undefined) { if (patch.type && !['inbound', 'outbound'].includes(patch.type)) throw new Error('Unknown type'); cur.type = patch.type || ''; }
  if (patch.note !== undefined) cur.note = clean(patch.note, 4000);
  await P([['HSET', 'pl:leadov', key, JSON.stringify(cur)]]);
  return { ok: true };
}

module.exports = {
  snapshot, syncCalendly, syncFathom, slimRecording, saveSheets, verifyGoogleToken, setOutcome, setLead, build, readTab, callerFromTitle, effectiveOutcome, calendlyOn,
  _setPipe: f => { _pipe = f; }, _setCerts: keys => { certCache = { keys, exp: Date.now() + 3600e3 }; }
};
