// Pipeline: one place for every BPO Hive lead and meeting.
//   Inbound  = came through the website: a website form, or a Calendly booking made on bpohive.com
//              (the site adds utm_source/utm_medium to every Calendly link) or from another tracked ad/site
//   Outbound = everything else: the callers' Lead Entry sheets (pushed here every 15 minutes by a small
//              Google Apps Script, see scripts/pipeline-sheets-sync.gs) and Calendly links the team sends
//   Meetings = Calendly (read with CALENDLY_TOKEN, a Calendly personal access token)
// A lead keeps the type of how they first came in, so a second or third meeting never turns an
// outbound lead into an inbound one. Calendly event types that are not sales calls (interviews,
// vendor meetings) are left out; which ones is set in Admin -> Pipeline -> Sources.
// Showed / No-show / Rescheduled / Cancelled is marked with one click in the admin; a no-show
// is also flagged in Calendly. Everything is kept in the same Upstash Redis as the form entries.
const crypto = require('node:crypto');
const { configured, pipe, listEntries } = require('./entries.cjs');

const CAL = 'https://api.calendly.com';
const BACKFILL_DAYS = 180;          // first Calendly sync reaches this far back
// After that, each sync loads one more slice of older history until it reaches BPO Hive's first booking.
const HISTORY_FROM = Date.parse(process.env.PIPELINE_HISTORY_FROM || '2022-04-01T00:00:00Z');
const HISTORY_SLICE_DAYS = 120;
// Show / no-show marking started in the admin on this date. Older meetings nobody marked count as "not tracked"
// (still booked, but left out of the show rate and the to-mark list).
const TRACKED_FROM = Date.parse(process.env.PIPELINE_TRACKED_FROM || '2026-09-01T00:00:00Z');
const RESCAN_PAST_DAYS = 45;        // every sync re-reads this window to catch cancellations / no-shows
const RESCAN_FUTURE_DAYS = 120;
const STALE_MS = 3 * 60 * 1000;     // the admin page re-syncs Calendly if older than this
const INVITEE_FETCHES_PER_RUN = 150;
const INVITEE_PARALLEL = 6;
const OUTCOMES = ['showed', 'no_show', 'rescheduled', 'cancelled'];
const STAGES = ['won', 'lost'];
// The simple flow: booked -> on the day it is a show or a no-show -> a show goes to "Shown" (the hot
// leads) and stays there while the team follows up -> "Dead" when unqualified or not replying, or "Won".
const DEALS = ['shown', 'won', 'dead'];
const LEGACY_DEAL = { met: 'shown', followup: 'shown', proposal: 'shown', negotiation: 'shown', hold: 'shown', lost: 'dead' };
const DEAD_REASONS = ['unqualified', 'no_reply', 'other'];
// How close a hot lead is (the "MUST CLOSE" sheet's own words).
// Must close and Nurture were dropped for Hot / Warm / Cold; old ones still give a lead its starting temperature.
const HOT_TAGS = ['contract'];
const TRAIL_MAX = 300;
const SKIP_FORMS = /calendly booking/i; // used only to enrich, not a lead of its own
// How warm a lead in Showed is: hot = actively engaging, warm = replying but not deciding now, cold = replying, longer timeframe.
const TEMPS = ['hot', 'warm', 'cold'];
const DEFAULT_SKIP_EVENTS = /interview|vendor/i; // Calendly event types left out until changed in Sources
const ALLOWED_SYNC_EMAILS = () => String(process.env.PIPELINE_SHEETS_EMAILS || 'amr@bpohive.com,info@bpohive.com,abdullah@bpohive.com').toLowerCase().split(/[,\s]+/).filter(Boolean);

let _pipe = pipe;
const P = cmds => _pipe(cmds);
const calToken = () => process.env.CALENDLY_TOKEN || process.env.Calendly_Token || process.env.CALENDLY_API_KEY || '';
const calendlyOn = () => Boolean(calToken());
const clean = (v, n = 500) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const emailIn = v => { const m = String(v || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? m[0] : ''; };
const FREE_MAIL = /^(gmail|googlemail|hotmail|yahoo|ymail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\.[a-z.]+$/i;
// Last 9 digits, so +1 (555) 123-4567 and 5551234567 match. Too short to be a real number = no match.
const phoneKey = v => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
const slug = v => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const uuidOf = uri => String(uri || '').split('/').pop();
const parseJSON = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/* ---------------- Calendly ---------------- */
async function cal(path, opt = {}) {
  const r = await fetch(path.startsWith('http') ? path : CAL + path, {
    method: opt.method || 'GET',
    headers: { Authorization: 'Bearer ' + calToken(), 'Content-Type': 'application/json' },
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
    let events = await listEvents(scope, from, now + RESCAN_FUTURE_DAYS * 864e5, deadline - 2500);
    // One older slice of history per run, once the recent window is loaded.
    const reach = state.reach || now - BACKFILL_DAYS * 864e5;
    let slice = null;
    if (state.backfilled && reach > HISTORY_FROM && Date.now() < deadline - 2500) {
      slice = { from: Math.max(HISTORY_FROM, reach - HISTORY_SLICE_DAYS * 864e5), to: reach };
      const old = await listEvents(scope, slice.from, slice.to, deadline - 1500);
      const seen = new Set(events.map(e => e.uri));
      old.forEach(e => { if (!seen.has(e.uri)) events.push(e); });
      slice.ids = new Set(old.map(e => e.uri));
    }
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
    // Newest first: upcoming and recent meetings get their names before old ones during the first load.
    queue.sort((a, b) => b.stale - a.stale || Math.abs(Date.parse(a.rec.start) - now) - Math.abs(Date.parse(b.rec.start) - now));
    const todo = queue.filter(q => q.stale).slice(0, INVITEE_FETCHES_PER_RUN);
    let fetched = 0, pos = 0;
    const worker = async () => {
      while (pos < todo.length && Date.now() < deadline - 900) {
        const item = todo[pos++];
        try {
          const j = await cal(`/scheduled_events/${item.rec.id}/invitees?count=20`);
          item.rec.invitees = (j.collection || []).map(slimInvitee);
          item.rec.checked = Date.now(); delete item.rec.error; fetched++;
        } catch (e) { item.rec.error = clean(e.message, 200); if (e.status === 429) break; }
      }
    };
    await Promise.all(Array.from({ length: INVITEE_PARALLEL }, worker));
    const cmds = [];
    queue.forEach(({ rec }) => { cmds.push(['SET', 'pl:m:' + rec.id, JSON.stringify(rec)], ['ZADD', 'pl:m', String(Date.parse(rec.start)), rec.id]); });
    const pending = queue.filter(q => q.stale && !q.rec.invitees).length;
    const next = { at: Date.now(), backfilled: state.backfilled || (pending === 0 && Date.now() < deadline), events: events.length, fetched, pending, error: '', reach: state.reach || 0 };
    // Move the history mark back only once every meeting in the slice has its invitee details.
    if (slice) { const left = queue.filter(q => slice.ids.has(q.rec.uri) && q.stale && !q.rec.invitees).length; next.reach = left ? reach : slice.from; next.historyPending = left; }
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
const faToken = () => process.env.FATHOM_API_KEY || process.env.Fathom_API_Key || process.env.FATHOM_TOKEN || '';
const fathomOn = () => Boolean(faToken());
async function fathom(path) {
  const r = await fetch(FATHOM + path, { headers: { 'X-Api-Key': faToken(), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
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
  return m ? clean(m[1], 60) : '';
}

/* ---------------- Sheet sources (editable in Admin → Pipeline → Sources) ---------------- */
const DEFAULT_SOURCES = [
  { id: '18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0', name: 'BPO Hive USA', tz: 'America/New_York' },
  { id: '1TM0xiCLeN2x2Gb3QMNd5sA-p0-hsyaJRj3W90KcBUi0', name: 'BPO Hive GCC', tz: 'Asia/Dubai' }
];
const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Muscat', 'UTC'];
const sheetIdOf = v => { const s = String(v || '').trim(); const m = s.match(/\/d\/([\w-]{20,})/); return m ? m[1] : (/^[\w-]{20,80}$/.test(s) ? s : ''); };
async function getSources() {
  const [raw] = await P([['GET', 'pl:sources']]);
  const list = parseJSON(raw);
  return Array.isArray(list) ? list : DEFAULT_SOURCES.map(x => Object.assign({}, x));
}
async function setSources(list) {
  if (!Array.isArray(list)) throw new Error('Unknown sources');
  const out = [], seen = new Set();
  list.slice(0, 20).forEach(x => {
    const id = sheetIdOf(x.url || x.id); if (!id || seen.has(id)) return; seen.add(id);
    out.push({ id, name: clean(x.name, 80) || 'Sheet', tz: TZS.includes(x.tz) ? x.tz : 'America/New_York' });
  });
  if (list.length && !out.length) throw new Error('Unknown sources: paste the full Google Sheet link');
  await P([['SET', 'pl:sources', JSON.stringify(out)]]);
  return out;
}

// Calendly event types to leave out of the Pipeline (job interviews, vendor calls...). Stored as a
// list of event names; until it is saved once, names matching DEFAULT_SKIP_EVENTS are left out.
function skippedEvent(name, skip) { return Array.isArray(skip) ? skip.includes(clean(name, 160)) : DEFAULT_SKIP_EVENTS.test(name || ''); }
// The Pipeline only counts meetings (and leads) from this date on. Saved in Admin -> Pipeline -> Sources.
async function setSince(date) {
  const d = clean(date, 10);
  if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z')))) throw new Error('Invalid: pick a date');
  await P([d ? ['SET', 'pl:since', d] : ['DEL', 'pl:since']]);
  return d;
}
async function setSkippedEvents(list) {
  if (!Array.isArray(list)) throw new Error('Unknown event types');
  const out = [...new Set(list.map(x => clean(x, 160)).filter(Boolean))].slice(0, 100);
  await P([['SET', 'pl:evskip', JSON.stringify(out)]]);
  return out;
}

/* ---------------- Reading a sheet tab ---------------- */
// Columns are found by their header text, so the order can change. Works for the "Lead Entry Form"
// response sheets (one row per booked appointment) and simple lead lists.
const HEAD = {
  at: /^(timestamp|date added|created)/i,
  name: /^(name|full name|contact|contact name|prospect|prospect name)$/i,
  title: /^(title|job title|position|role|prospect title.*)$/i,
  company: /^(company|company name|account|business|business name)$/i,
  campaign: /^(campaign|list)$/i,
  vertical: /^vertical( type)?$/i,
  caller: /^(agent|agent name|caller|sdr|setter)$/i,
  apptDate: /^(appointment date|meeting date)$/i,
  apptTime: /^(appointment time|meeting time)$/i,
  tz: /^time ?zone$/i,
  email: /^(email|e-mail|work email|prospect email)$/i,
  phone: /^(number|phone|phone number|mobile|contact info|prospect phone(?! 2).*)$/i,
  recording: /^(call recording link|recording|call recording)$/i,
  notes: /^(call notes|notes|update trail|history|comments)$/i,
  update: /^(latest update|status|call outcome|outcome|last update)$/i,
  confirm: /^confirmation status$/i,
  followup: /^pre-meeting follow-?up$/i,
  show: /^(show status|showed|show-up status|attendance)$/i,
  location: /^(location.*|address)$/i
};
function readTab(values) {
  const rows = (values || []).filter(r => Array.isArray(r));
  const hi = rows.findIndex(r => r.some(c => HEAD.name.test(clean(c))) && r.some(c => HEAD.company.test(clean(c))));
  if (hi < 0) return [];
  const map = {};
  rows[hi].forEach((c, i) => { for (const [k, re] of Object.entries(HEAD)) if (map[k] == null && re.test(clean(c))) { map[k] = i; break; } });
  return rows.slice(hi + 1).map(r => {
    const g = k => (map[k] == null ? '' : clean(r[map[k]], k === 'notes' ? 3000 : 500));
    const name = g('name'), company = g('company');
    if (!name && !company) return null;
    const email = emailIn(g('email')) || emailIn(g('phone')) || emailIn(r.join(' '));
    const phone = /\d{6,}/.test(g('phone').replace(/\D/g, '')) && !emailIn(g('phone')) ? g('phone') : '';
    const rec = /^https?:\/\//.test(g('recording')) ? g('recording') : '';
    return { at: g('at'), name, title: g('title'), company, campaign: g('campaign'), vertical: g('vertical'), caller: g('caller'), apptDate: g('apptDate'), apptTime: g('apptTime'), tz: g('tz'),
      update: g('update'), notes: g('notes'), trail: g('notes'), confirm: g('confirm'), followup: g('followup'), show: g('show'), recording: rec, location: g('location'), phone, email };
  }).filter(Boolean);
}

// "Wed, Sep 9, 2026" / "10/30/2026" + "6:00 PM" / "3:30:00 PM" in a time zone -> UTC milliseconds
const TZ_ABBR = { est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', eastern: 'America/New_York', cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', central: 'America/Chicago', mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', pacific: 'America/Los_Angeles', gst: 'Asia/Dubai', uae: 'Asia/Dubai', dubai: 'Asia/Dubai', ksa: 'Asia/Riyadh', ast: 'Asia/Riyadh', riyadh: 'Asia/Riyadh', saudi: 'Asia/Riyadh', eet: 'Africa/Cairo', cairo: 'Africa/Cairo', egypt: 'Africa/Cairo', gmt: 'UTC', utc: 'UTC', bst: 'Europe/London', uk: 'Europe/London' };
function tzOffsetMs(ms, tz) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
function apptTime(dateStr, timeStr, tzStr, defTz) {
  const d = clean(dateStr, 60); if (!d) return null;
  let y, mo, da;
  const mdy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) { mo = +mdy[1]; da = +mdy[2]; y = +mdy[3] < 100 ? 2000 + +mdy[3] : +mdy[3]; }
  else { const t = Date.parse(d.replace(/^[a-z]+,\s*/i, '') + ' 12:00 UTC'); if (isNaN(t)) return null; const x = new Date(t); y = x.getUTCFullYear(); mo = x.getUTCMonth() + 1; da = x.getUTCDate(); }
  let h = 12, mi = 0;
  const tm = clean(timeStr, 40).match(/(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?/i);
  if (tm) { h = +tm[1] % 12 + (tm[3] && /p/i.test(tm[3]) ? 12 : 0); if (!tm[3] && +tm[1] >= 12) h = +tm[1]; mi = +(tm[2] || 0); }
  let tz = TZ_ABBR[slug(tzStr)] || (TZS.includes(clean(tzStr)) ? clean(tzStr) : '') || defTz || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/New_York'; }
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return isNaN(utc) ? null : utc;
}
function sheetOutcome(show) {
  const v = slug(show);
  if (!v) return '';
  if (/no ?show|did not show|didn t show|not show/.test(v)) return 'no_show';
  if (/resched/.test(v)) return 'rescheduled';
  if (/cancel/.test(v)) return 'cancelled';
  if (/show|attend|held|yes/.test(v)) return 'showed';
  return '';
}

async function saveSheets(body, email) {
  const sources = await getSources();
  const allowed = new Map(sources.map(x => [x.id, x]));
  const sheets = Array.isArray(body && body.sheets) ? body.sheets.slice(0, 40) : [];
  const byFile = {};
  sheets.forEach(s => {
    const id = clean(s.id, 80); if (!allowed.has(id)) return;
    const src = allowed.get(id);
    const f = byFile[id] || (byFile[id] = { id, title: clean(s.title, 120), name: src.name, tz: src.tz, caller: callerFromTitle(s.title), rows: [], tabs: [], error: '' });
    if (s.error) { f.error = clean(s.error, 200); return; }
    const rows = readTab((s.rows || []).slice(0, 5000));
    if (rows.length) f.tabs.push(clean(s.tab, 80));
    rows.forEach(r => f.rows.push(Object.assign(r, { tab: clean(s.tab, 80) })));
  });
  const files = Object.values(byFile);
  const at = Date.now();
  const [known] = await P([['SMEMBERS', 'pl:sheets']]);
  const cmds = [];
  (known || []).filter(id => !allowed.has(id)).forEach(id => cmds.push(['SREM', 'pl:sheets', id], ['DEL', 'pl:sheet:' + id]));
  files.forEach(f => { f.syncedAt = at; f.by = email; cmds.push(['SET', 'pl:sheet:' + f.id, JSON.stringify(f)], ['SADD', 'pl:sheets', f.id]); });
  cmds.push(['SET', 'pl:sheets:at', String(at)]);
  await P(cmds);
  return { files: files.map(f => ({ title: f.title, name: f.name, rows: f.rows.length, error: f.error })) };
}

/* ---------------- Merge everything into leads ---------------- */
function effectiveOutcome(m, now = Date.now()) {
  const ov = m.override;
  if (ov && OUTCOMES.includes(ov.outcome)) return ov.outcome;
  if (m.sheetOutcome) return m.sheetOutcome;
  const inv = (m.invitees || [])[0] || {};
  if (m.status === 'canceled') return inv.rescheduled ? 'rescheduled' : 'cancelled';
  if (inv.noShow) return 'no_show';
  if (m.fathomSpoke) return 'showed';
  if (Date.parse(m.end) < TRACKED_FROM) return 'untracked';
  if (Date.parse(m.end) < now) return 'needs';
  return 'upcoming';
}

// A Calendly booking carries the utm_* of the link it was booked from. The website adds them to every
// Calendly link; links the team sends by email or the callers send have none.
function webBooking(utm) {
  const u = utm || {};
  if (!u.source && !u.medium) return false;
  return !/e-?mail|outbound|sequence|cold|salesfinity|caller/i.test([u.source, u.medium, u.campaign].join(' '));
}
const ORIGIN = { website: 'Website form', web_booking: 'Booked on the website', sheet: 'Lead Entry sheet', direct: 'Calendly link (not from the website)', manual: 'Added by hand' };

function websiteLead(e) {
  const f = e.fields || {};
  const name = clean(f.name || [f.firstName, f.lastName].filter(Boolean).join(' '), 160);
  return {
    at: e.at, name, email: emailIn(f.email || f.work_email), phone: clean(f.phone, 40), company: clean(f.company || f.brokerage || f.website, 160),
    title: clean(f.jobTitle || f.role, 120), campaign: /real estate/i.test(e.form) ? 'Real estate recruiting' : 'Website', detail: f, page: e.page, id: e.id
  };
}

async function load() {
  const [mIds, sheetIds, sheetsAt, calState, ovRaw, leadOvRaw, fIds, faState, skipRaw, trailRaw, manualRaw, sinceRaw, hiddenRaw] = await P([
    ['ZRANGE', 'pl:m', 0, -1], ['SMEMBERS', 'pl:sheets'], ['GET', 'pl:sheets:at'], ['GET', 'pl:cal:state'], ['HGETALL', 'pl:outcomes'], ['HGETALL', 'pl:leadov'], ['ZRANGE', 'pl:f', 0, -1], ['GET', 'pl:fa:state'], ['GET', 'pl:evskip'], ['HGETALL', 'pl:trail'], ['HGETALL', 'pl:manual'], ['GET', 'pl:since'], ['HGETALL', 'pl:hidden']
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
  const skip = parseJSON(skipRaw);
  const trails = hash(trailRaw), manual = Object.values(hash(manualRaw)).filter(Boolean);
  return { since: sinceRaw || '', hidden: hash(hiddenRaw), meetings, sheets, entries, leadOv, trails, manual, recordings, outcomes, skipEvents: Array.isArray(skip) ? skip : null, sheetsAt: Number(sheetsAt) || 0, calState: parseJSON(calState) || {}, faState: parseJSON(faState) || {} };
}

// One lead can have notes and stage changes saved under more than one key (the same person booked twice
// before the bookings were joined up). The first key's settings win; a later stage change wins over an older one.
function mergeOv(list) {
  const all = list.filter(o => o && typeof o === 'object');
  if (all.length < 2) return all[0] || {};
  const out = Object.assign({}, ...all.slice(1).reverse(), all[0]);
  const lastDeal = all.filter(o => o.deal || o.dealAt).sort((a, b) => (a.dealAt || 0) - (b.dealAt || 0)).pop();
  if (lastDeal) { out.deal = lastDeal.deal || ''; out.dealAt = lastDeal.dealAt || 0; out.deadReason = lastDeal.deadReason || ''; }
  ['hot', 'temp', 'next', 'value', 'type'].forEach(k => { if (!out[k]) { const o = all.find(x => x[k]); if (o) out[k] = o[k]; } });
  return out;
}
function mergeTrails(list) {
  const seen = new Set(), out = [];
  list.forEach(t => (Array.isArray(t) ? t : []).forEach(x => { const id = x.id || x.at + '|' + x.text; if (!seen.has(id)) { seen.add(id); out.push(x); } }));
  return list.filter(Array.isArray).length > 1 ? out.sort((a, b) => a.at - b.at) : out;
}
// Moves anything saved under a lead's other keys onto its main key, so later edits only touch one record.
async function absorb(key, also) {
  const keys = (Array.isArray(also) ? also : []).map(String).filter(k => k !== key && /^[en]:.{1,400}$/.test(k)).slice(0, 20);
  if (!keys.length) return;
  const all = [key].concat(keys);
  const raw = await P(all.map(k => ['HGET', 'pl:leadov', k]).concat(all.map(k => ['HGET', 'pl:trail', k])));
  const ovs = raw.slice(0, all.length).map(parseJSON), trs = raw.slice(all.length).map(parseJSON);
  if (!ovs.slice(1).some(Boolean) && !trs.slice(1).some(t => Array.isArray(t) && t.length)) return;
  const ov = mergeOv(ovs), trail = mergeTrails(trs).sort((a, b) => a.at - b.at).slice(-TRAIL_MAX);
  await P([['HSET', 'pl:leadov', key, JSON.stringify(ov)], ['HSET', 'pl:trail', key, JSON.stringify(trail)], ['HDEL', 'pl:leadov'].concat(keys), ['HDEL', 'pl:trail'].concat(keys)]);
}

const OWN_MAIL = /@(bpohive\.com|bpo-outsourcing-services\.com)$/i;
function isTestLead(L) {
  if (L.origin === 'manual') return false;
  const emails = [L.email].concat((L.aliases || []).filter(k => k.startsWith('e:')).map(k => k.slice(2)));
  const names = [L.name].concat((L.aliases || []).filter(k => k.startsWith('n:')).map(k => k.slice(2).split('|')[0]));
  return emails.some(e => OWN_MAIL.test(e || '')) || names.some(n => /\btest\b/i.test(n || '')) || emails.some(e => /^test[\W_]/i.test(e || ''));
}
function build(data, now = Date.now()) {
  const leads = new Map(), byEmail = new Map(), byName = new Map(), byPhone = new Map(), byDomain = new Map();
  const keyFor = (email, name, company) => email ? 'e:' + email : 'n:' + slug(name) + '|' + slug(company);
  // Someone who books more than once is one lead: matched by email, full name, phone number,
  // or the same company email domain with the same first name (free mail domains like gmail don't count).
  const domKey = (email, name) => { const d = String(email || '').split('@')[1] || '', f = slug(name).split(' ')[0] || ''; return d && !FREE_MAIL.test(d) && f.length > 1 ? d + '|' + f : ''; };
  // Two people at one company can share a first name, so the surnames must not clash ("Amr" and "Amr Abdelrazzak" are fine).
  const sameSurname = (a, b) => { const x = slug(a).split(' ').slice(1).join(''), y = slug(b).split(' ').slice(1).join(''); return !x || !y || x.slice(0, 3) === y.slice(0, 3); };
  function find(email, name, phone) {
    if (email && byEmail.has(email)) return byEmail.get(email);
    const n = slug(name);
    if (n && n.includes(' ') && byName.has(n)) return byName.get(n);
    const ph = phoneKey(phone); if (ph && byPhone.has(ph)) return byPhone.get(ph);
    const dk = domKey(email, name); if (dk && byDomain.has(dk)) { const hit = byDomain.get(dk).find(L => sameSurname(L.name, name)); if (hit) return hit; }
    return null;
  }
  function add(kind, rec) {
    let L = find(rec.email, rec.name, rec.phone);
    const own = keyFor(rec.email, rec.name, rec.company);
    if (!L) {
      L = { key: own, aliases: [], name: '', email: '', phone: '', company: '', title: '', firstAt: null, sources: [], campaigns: [], callers: [], verticals: [], updates: [], meetings: [], website: [], sheetRows: [], recordings: [] };
      leads.set(L.key, L);
    } else if (own !== L.key && !L.aliases.includes(own)) L.aliases.push(own);
    ['name', 'email', 'phone', 'company', 'title'].forEach(k => { if (!L[k] && rec[k]) L[k] = rec[k]; });
    [L.email, rec.email].forEach(e => { if (e && !byEmail.has(e)) byEmail.set(e, L); });
    [L.name, rec.name].forEach(x => { const n = slug(x); if (n && n.includes(' ') && !byName.has(n)) byName.set(n, L); });
    [L.phone, rec.phone].forEach(x => { const ph = phoneKey(x); if (ph && !byPhone.has(ph)) byPhone.set(ph, L); });
    [[L.email, L.name], [rec.email, rec.name], [rec.email, L.name]].forEach(([e, x]) => { const dk = domKey(e, x); if (!dk) return; const list = byDomain.get(dk) || []; if (!list.includes(L)) list.push(L); byDomain.set(dk, list); });
    const t = Date.parse(rec.at);
    if (!isNaN(t) && (!L.firstAt || t < L.firstAt)) { L.firstAt = t; L.firstKind = kind; L.origin = rec.origin || kind; }
    else if (!L.origin) L.origin = rec.origin || kind;
    if (!L.sources.includes(kind)) L.sources.push(kind);
    if (rec.campaign && !L.campaigns.includes(rec.campaign)) L.campaigns.push(rec.campaign);
    return L;
  }
  // Start date: a lead is kept only if something happened with it on or after that date (a meeting, a sheet
  // entry, a website form or a note from the team). Leads added by hand are always kept. For the leads kept,
  // older meetings stay only when they were already marked, so the history is there but nothing old needs marking.
  const since = data.since ? Date.parse(data.since + 'T00:00:00Z') : 0;
  const old = ts => Boolean(since && ts && !isNaN(ts) && ts < since);
  // 0. Leads added by hand (met outside Calendly and the sheets)
  const manualL = {};
  (data.manual || []).forEach(x => { const L = add('manual', Object.assign({}, x, { origin: 'manual' })); L.manualType = x.type; L.country = x.country || ''; manualL[x.id] = L; });
  // 1. Website (inbound)
  const enrich = [];
  data.entries.forEach(e => {
    if (SKIP_FORMS.test(e.form)) { enrich.push(e); return; }
    const w = websiteLead(e); if (!w.email && !w.name) return;
    const L = add('website', Object.assign(w, { origin: 'website' })); L.website.push({ at: e.at, form: e.form, page: e.page, fields: w.detail, id: e.id });
  });
  // 2. Sheets (outbound): each Lead Entry row is a lead and, when it has a date, a booked appointment
  const sheetAppts = [];
  data.sheets.forEach(s => (s.rows || []).forEach(r => {
    const caller = r.caller || s.caller || '';
    const campaign = s.name || r.campaign || 'Outbound';
    const L = add('sheet', Object.assign({}, r, { campaign, origin: 'sheet' }));
    if (caller && !L.callers.includes(caller)) L.callers.push(caller);
    if (r.vertical && !L.verticals.includes(r.vertical)) L.verticals.push(r.vertical);
    const start = apptTime(r.apptDate, r.apptTime, r.tz, s.tz);
    L.sheetRows.push({ sheet: s.name || s.title, caller, at: r.at, update: r.update, trail: r.notes, campaign, vertical: r.vertical, recording: r.recording, confirm: r.confirm, followup: r.followup, show: r.show, appt: start, location: r.location });
    const text = r.show ? 'Show status: ' + r.show : r.confirm ? 'Confirmation: ' + r.confirm : (r.update || (start ? 'Appointment booked' : ''));
    if (text) L.updates.push({ at: r.at, text, by: caller });
    if (start) sheetAppts.push({ L, r, s, start, caller, campaign, id: 's_' + crypto.createHash('sha1').update(s.id + '|' + r.at + '|' + slug(r.name) + '|' + r.apptDate).digest('hex').slice(0, 24) });
  }));
  // 3. Calendly meetings (event types that are not sales calls are left out entirely)
  const eventTypes = {};
  data.meetings = data.meetings.filter(m => {
    const skip = skippedEvent(m.name, data.skipEvents);
    const e = eventTypes[m.name || ''] || (eventTypes[m.name || ''] = { name: m.name || '', meetings: 0, skipped: skip });
    e.meetings++;
    return !skip;
  });
  // Bookings made in the website's own booking pop-up are also saved as a "Calendly booking" entry.
  const bookedOnSite = new Set(enrich.map(e => emailIn(e.fields && e.fields.email)).filter(Boolean));
  data.meetings.forEach(m => {
    const inv = (m.invitees || [])[0];
    if (!inv) return;
    const company = (inv.qa.find(x => /company|business|organi[sz]ation|brokerage/i.test(x.q)) || {}).a || '';
    const origin = webBooking(inv.utm) || (inv.email && bookedOnSite.has(inv.email)) ? 'web_booking' : 'direct';
    const L = add('calendly', { at: inv.created || m.created, name: inv.name, email: inv.email, company, phone: inv.phone, origin });
    m.leadKey = L.key;
    L.meetings.push(m.id);
  });
  // 3b. Sheet appointments: join the Calendly meeting at the same time, or stand as their own meeting
  const mById0 = new Map(data.meetings.map(m => [m.id, m]));
  const iso = ms => new Date(ms).toISOString();
  sheetAppts.forEach(a => {
    const info = { source: a.s.name || a.s.title, caller: a.caller, recording: a.r.recording, confirm: a.r.confirm, followup: a.r.followup, show: a.r.show, notes: a.r.notes, vertical: a.r.vertical };
    const cm = a.L.meetings.map(id => mById0.get(id)).filter(Boolean).find(m => !m.sheet && Math.abs(Date.parse(m.start) - a.start) <= 3 * 3600e3);
    if (cm) { cm.sheet = info; cm.sheetOutcome = sheetOutcome(a.r.show); return; }
    const created = Date.parse(a.r.at);
    const m = { id: a.id, kind: 'sheet', name: a.r.vertical ? a.r.vertical + ' appointment' : 'Appointment', start: iso(a.start), end: iso(a.start + 30 * 60e3), status: 'active',
      created: iso(isNaN(created) ? a.start : created), host: '', invitees: [{ name: a.r.name, email: a.r.email, phone: a.r.phone, qa: [], utm: {} }],
      sheet: info, sheetOutcome: sheetOutcome(a.r.show), override: (data.outcomes || {})[a.id] || null, leadKey: a.L.key };
    data.meetings.push(m); mById0.set(m.id, m); a.L.meetings.push(m.id);
  });
  // 3b. A meeting entered by hand with a lead added at the Booked or No-show stage
  (data.manual || []).forEach(x => {
    const L = manualL[x.id], start = Date.parse(x.meetingAt); if (!L || isNaN(start)) return;
    if (L.meetings.map(id => mById0.get(id)).some(m => m && Math.abs(Date.parse(m.start) - start) <= 3 * 3600e3)) return;
    const id = 'h_' + x.id;
    const m = { id, kind: 'manual', name: 'Meeting (added by hand)', start: iso(start), end: iso(start + 30 * 60e3), status: 'active', created: x.at, host: '',
      invitees: [{ name: x.name, email: x.email || '', phone: x.phone || '', qa: [], utm: {} }], override: (data.outcomes || {})[id] || null, leadKey: L.key };
    data.meetings.push(m); mById0.set(id, m); L.meetings.push(id);
  });
  // 4. Fathom recordings: attach to the lead (by the prospect's email or name) and to the meeting it belongs to
  let unlinked = 0;
  // Many calls are recorded as "Impromptu Zoom Meeting" with no invitees, so when the email or name does not match,
  // the recording is matched to the booked meeting that started at the same time (within 30 minutes), or to a lead
  // whose company or full name is in the recording title (e.g. "BPO Hive & David | Leonardo Worldwide").
  const slots = data.meetings.filter(m => m.leadKey && m.status !== 'canceled' && m.status !== 'cancelled' && !isNaN(Date.parse(m.start)));
  const byTitle = [...leads.values()].map(L => [L, [L.company, L.name].map(slug).filter(x => x && x.length >= 6 && (x.includes(' ') || x === slug(L.company)))]).filter(x => x[1].length);
  // A call at the same time as a booked meeting can be the team talking while they wait for a no-show, so a time
  // match only counts when someone outside the team spoke (or, with no transcript, the summary names the lead).
  const first = n => slug(n).split(' ')[0] || '';
  const team = new Set(['bpo', 'bpohive', 'amr', 'abdullah', 'abdallah', 'mai', 'hisham', 'layla', 'laila', 'maira', 'myra'].concat(
    [...leads.values()].flatMap(L => L.callers || []).map(first),
    (data.recordings || []).flatMap(r => [r.recordedBy].concat((r.invitees || []).filter(i => !i.external).map(i => i.name))).map(first)).filter(Boolean));
  const prospectOn = (r, L) => {
    const sp = (r.speakers || []).filter(n => n && !/^(speaker\s*\d*|unknown.*)$/i.test(n.trim()));
    if (sp.length) return sp.some(n => first(n) === first(L.name) || !team.has(first(n)));
    const txt = ' ' + slug(r.summary) + ' ', co = slug(L.company), nm = slug(L.name);
    return Boolean((co.length >= 4 && txt.includes(' ' + co + ' ')) || (nm.includes(' ') && txt.includes(' ' + nm + ' ')));
  };
  (data.recordings || []).forEach(r => {
    const ext = (r.invitees || []).filter(i => i.external);
    let L = null;
    for (const i of ext) { L = find(i.email, i.name); if (L) break; }
    if (!L) {
      const t = Date.parse(r.start || r.scheduled);
      const near = slots.map(m => [m, Math.min(Math.abs(Date.parse(m.start) - t), Math.abs(Date.parse(m.start) - Date.parse(r.scheduled || r.start)))]).filter(x => x[1] <= 30 * 60e3).sort((a, b) => a[1] - b[1]);
      if (near.length && (near.length === 1 || near[0][0].leadKey === near[1][0].leadKey || near[1][1] - near[0][1] > 10 * 60e3)) { const c = leads.get(near[0][0].leadKey); if (c && prospectOn(r, c)) L = c; }
    }
    if (!L) { const tt = ' ' + slug(r.title) + ' '; const hit = byTitle.filter(x => x[1].some(n => tt.includes(' ' + n + ' '))); if (hit.length === 1) L = hit[0][0]; }
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
    const ov = mergeOv([L.key].concat(L.aliases).map(k => data.leadOv[k]));
    const ms = L.meetings.map(id => mById.get(id)).filter(Boolean).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    // The type is how they first came in, so follow-up meetings keep it.
    const type = ov.type || (L.origin === 'manual' && L.manualType ? L.manualType : L.origin === 'website' || L.origin === 'web_booking' ? 'inbound' : 'outbound');
    // Number the meetings that actually stand (not cancelled or moved): 1 = first meeting, 2+ = follow-ups.
    let n = 0; ms.forEach(m => { m.seq = m.outcome === 'cancelled' || m.outcome === 'rescheduled' ? 0 : ++n; });
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
    // Opportunity stage: set by hand, or worked out from the meetings.
    const showedAt = ms.filter(m => m.outcome === 'showed').map(m => Date.parse(m.start));
    const spoke = L.recordings.filter(r => r.externalSpoke).map(r => Date.parse(r.start));
    const firstShow = Math.min(...showedAt.concat(spoke).filter(x => !isNaN(x)));
    let deal = DEALS.includes(ov.deal) ? ov.deal : LEGACY_DEAL[ov.deal] || (ov.stage === 'won' ? 'won' : ov.stage === 'lost' ? 'dead' : '');
    // A dead lead who books a new meeting comes back on its own.
    if (deal === 'dead' && ms.some(m => m.outcome === 'upcoming' && Date.parse(m.created) > (ov.dealAt || 0))) deal = '';
    const dealAuto = !deal;
    if (!deal && isFinite(firstShow)) deal = 'shown';
    if (deal === 'won') stage = 'won'; else if (deal === 'dead') stage = 'lost';
    const outs2 = ms.map(m => m.outcome);
    const status = deal || (outs2.includes('upcoming') ? 'booked' : outs2.includes('needs') ? 'to_mark' : outs2.includes('no_show') ? 'no_show' : outs2.includes('untracked') ? 'past' : outs2.length ? 'cancelled' : 'new');
    const shownAt = isFinite(firstShow) ? firstShow : 0;
    const trail = mergeTrails([L.key].concat(L.aliases).map(k => (data.trails || {})[k]));
    const acts = [L.firstAt].concat(trail.map(x => x.at), ms.filter(m => Date.parse(m.start) < now).map(m => Date.parse(m.start)), ms.map(m => Date.parse(m.created)), L.sheetRows.map(r => Date.parse(r.at)), L.recordings.map(r => Date.parse(r.start))).filter(x => x && !isNaN(x) && x <= now);
    const latest = L.updates.slice(-1)[0];
    return {
      key: L.key, aliases: L.aliases, name: ov.name || L.name, email: ov.email || L.email, phone: ov.phone || L.phone, company: ov.company || L.company, edited: Boolean(ov.name || ov.phone || ov.company || ov.email), title: L.title, type, stage, origin: ORIGIN[L.origin] || '',
      firstAt: L.firstAt, sources: L.sources, campaigns: L.campaigns, callers: L.callers, verticals: L.verticals,
      latest: latest ? latest.text : (L.website[0] ? 'Sent the ' + L.website[0].form + ' form' : ''),
      next: next ? next.start : null, lastMeeting: last ? { start: last.start, outcome: last.outcome } : null,
      meetings: ms.map(m => m.id), website: L.website, sheetRows: L.sheetRows, note: ov.note || '', stageOverride: ov.stage || '', typeOverride: ov.type || '',
      deal, dealAuto, status, shownAt, hot: deal === 'shown' && HOT_TAGS.includes(ov.hot) ? ov.hot : '', temp: deal === 'shown' ? (TEMPS.includes(ov.temp) ? ov.temp : ov.hot === 'must_close' || ov.hot === 'contract' ? 'hot' : ov.hot === 'nurture' ? 'cold' : '') : '', tempSet: deal === 'shown' && TEMPS.includes(ov.temp), country: L.country || '', deadReason: deal === 'dead' ? (ov.deadReason || '') : '', dealAt: ov.dealAt || shownAt, value: Number(ov.value) || 0, nextStep: ov.next && ov.next.text ? ov.next : null,
      attempts: ((data.trails || {})[L.key] || []).filter(x => x.kind === 'note' && x.at >= shownAt).length, noShows: outs2.filter(o => o === 'no_show').length,
      lastBooked: ms.length ? (([...ms].sort((a, b) => Date.parse(b.created) - Date.parse(a.created))[0]) || {}).created || null : null,
      trail, lastActivity: acts.length ? Math.max(...acts) : 0,
      recordings: L.recordings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).map(r => ({ id: r.id, title: r.title, start: r.start, url: r.url, recordedBy: r.recordedBy, spoke: r.externalSpoke, summary: r.summary, actions: r.actions }))
    };
  }).sort((a, b) => (b.firstAt || 0) - (a.firstAt || 0));
  // Test bookings are left out: anyone booked with one of our own email addresses, or named "test".
  const testKeys = new Set([...leads.values()].filter(isTestLead).map(L => L.key));
  // Leads deleted by hand are left out too, unless they book again after being deleted.
  const hidden = data.hidden || {}, deleted = [];
  out.forEach(l => {
    const k = [l.key].concat(l.aliases || []).find(x => hidden[x]); if (!k) return;
    const h = hidden[k] || {};
    if (l.lastBooked && Date.parse(l.lastBooked) > (h.at || 0)) return;
    testKeys.add(l.key); deleted.push({ key: k, name: l.name || h.name || '', company: l.company || h.company || '', at: h.at || 0, by: h.by || '' });
  });
  if (testKeys.size) out.splice(0, out.length, ...out.filter(l => !testKeys.has(l.key)));
  const meetings = data.meetings.filter(m => !testKeys.has(m.leadKey)).map(m => {
    const inv = (m.invitees || [])[0] || {};
    const L = leads.get(m.leadKey);
    const lead = L ? out.find(x => x.key === L.key) : null;
    return {
      id: m.id, name: m.name, start: m.start, end: m.end, status: m.status, created: m.created, host: m.host,
      invitee: { name: inv.name || '', email: inv.email || '', phone: inv.phone || '', qa: inv.qa || [], cancelReason: inv.cancelReason || '', utm: inv.utm || {} },
      outcome: m.outcome || effectiveOutcome(m, now), auto: !m.override, noShowInCalendly: Boolean(inv.noShow), fathom: m.fathom || null, viaFathom: Boolean(!m.override && !m.sheetOutcome && m.fathomSpoke && m.outcome === 'showed'), kind: m.kind || 'calendly', sheet: m.sheet || null, viaSheet: Boolean(!m.override && m.sheetOutcome),
      seq: m.seq || 0, leadKey: m.leadKey || null, company: lead ? lead.company : '', type: lead ? lead.type : 'outbound', callers: lead ? lead.callers : [], campaigns: lead ? lead.campaigns : []
    };
  }).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  if (since) {
    const recent = l => l.origin === ORIGIN.manual || l.meetings.some(id => { const m = mById.get(id); return m && !old(Date.parse(m.start)); }) ||
      (l.website || []).some(w => !old(Date.parse(w.at))) || (l.sheetRows || []).some(r => !old(r.appt || Date.parse(r.at))) || (l.trail || []).some(x => !old(x.at));
    const keep = new Set(out.filter(recent).map(l => l.key));
    const done = ['showed', 'no_show', 'cancelled', 'rescheduled'];
    const ms2 = meetings.filter(m => m.leadKey && keep.has(m.leadKey) && (!old(Date.parse(m.start)) || done.includes(m.outcome)));
    const ids = new Set(ms2.map(m => m.id));
    const out2 = out.filter(l => keep.has(l.key)).map(l => Object.assign(l, { meetings: l.meetings.filter(id => ids.has(id)) }));
    return { leads: out2, meetings: ms2, deleted, unlinked, eventTypes: Object.values(eventTypes).sort((a, b) => b.meetings - a.meetings) };
  }
  return { leads: out, meetings, deleted, unlinked, eventTypes: Object.values(eventTypes).sort((a, b) => b.meetings - a.meetings) };
}

async function snapshot({ sync = true } = {}) {
  let calSync = null;
  const sf = require('./salesfinity.cjs');
  if (sync) [calSync] = await Promise.all([calendlyOn() ? syncCalendly() : null, fathomOn() ? syncFathom() : null, sf.on() ? sf.sync().catch(() => null) : null]);
  const data = await load();
  const { leads, meetings, unlinked, eventTypes, deleted } = build(data);
  // Company profiles and booking-call summaries (lib/intel.cjs), shown on the cards.
  // Salesfinity "Meeting Set" calls for Calendly bookings without a Lead Entry Form recording.
  let sfState = {};
  try { if (sf.on()) { const [calls, [st]] = await Promise.all([sf.all(), P([['GET', 'pl:sf:state']])]); sf.attach(leads, meetings, calls); sfState = parseJSON(st) || {}; } } catch (e) { sfState = { error: e.message }; }
  let intelState = {};
  try {
    const intel = require('./intel.cjs');
    const [all, [st]] = await Promise.all([intel.getAll(), P([['GET', 'pl:intel:state']])]);
    leads.forEach(l => { const it = intel.intelFor(all, l); if (it) l.intel = it; });
    intelState = parseJSON(st) || {};
  } catch (e) { intelState = { error: e.message }; }
  return {
    leads, meetings,
    status: {
      since: data.since || '', deleted: deleted.sort((a, b) => b.at - a.at),
      calendly: { eventTypes, connected: calendlyOn(), lastSync: data.calState.at || 0, error: data.calState.error || '', events: data.calState.events || 0, backfilled: Boolean(data.calState.backfilled), justRan: Boolean(calSync && !calSync.skipped) },
      sheets: { lastSync: data.sheetsAt, files: data.sheets.map(s => ({ id: s.id, name: s.name || s.title, title: s.title, rows: (s.rows || []).length, syncedAt: s.syncedAt, error: s.error || '' })) },
      fathom: { connected: fathomOn(), lastSync: data.faState.at || 0, error: data.faState.error || '', recordings: (data.recordings || []).length, unlinked, backfilled: Boolean(data.faState.backfilled) },
      website: { entries: data.entries.length },
      intel: { error: intelState.error || '', pausedUntil: intelState.pausedUntil || 0 },
      salesfinity: { connected: sf.on(), lastSync: sfState.at || 0, error: sfState.error || '' }
    }
  };
}

/* ---------------- Admin actions ---------------- */
async function setOutcome(id, outcome) {
  if (!/^[\w-]{2,64}$/.test(String(id))) throw new Error('Unknown meeting');
  if (/^(s_[a-f0-9]{24}|h_[a-f0-9]{12})$/.test(id)) {
    if (outcome === 'clear') { await P([['HDEL', 'pl:outcomes', id]]); return { ok: true }; }
    if (!OUTCOMES.includes(outcome)) throw new Error('Unknown outcome');
    await P([['HSET', 'pl:outcomes', id, JSON.stringify({ outcome, at: Date.now() })]]);
    return { ok: true, calendly: '' };
  }
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

// One update from the team: a note, a stage move, a deal value or the next step. Every change is
// written to the lead's trail with the date, time and who made it.
async function updateLead(key, u = {}, by = '', also) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await absorb(key, also);
  const [raw, rawT] = await P([['HGET', 'pl:leadov', key], ['HGET', 'pl:trail', key]]);
  const cur = parseJSON(raw) || {};
  const trail = Array.isArray(parseJSON(rawT)) ? parseJSON(rawT) : [];
  const at = Date.now(), who = clean(by, 60) || 'Admin', add = [];
  if (u.deal !== undefined && u.deal !== null) {
    const to = String(u.deal);
    if (to && !DEALS.includes(to)) throw new Error('Unknown stage');
    const from = clean(u.from, 20);
    const reason = to === 'dead' ? (DEAD_REASONS.includes(u.reason) ? u.reason : 'other') : '';
    if (to !== (cur.deal || '') || (to === 'dead' && reason !== cur.deadReason)) {
      cur.deal = to; cur.dealAt = at; cur.deadReason = reason;
      if (STAGES.includes(cur.stage)) cur.stage = '';
      add.push(Object.assign({ kind: 'stage', to: to || 'auto', from: from || '' }, reason ? { reason } : {}));
    }
  }
  if (u.hot !== undefined && u.hot !== null) {
    const h = HOT_TAGS.includes(u.hot) ? u.hot : '';
    if (h !== (cur.hot || '')) { cur.hot = h; add.push({ kind: 'hot', hot: h }); }
  }
  if (u.temp !== undefined && u.temp !== null) {
    const tp = TEMPS.includes(u.temp) ? u.temp : '';
    if (tp !== (cur.temp || '')) { cur.temp = tp; add.push({ kind: 'temp', temp: tp }); }
  }
  if (u.value !== undefined && u.value !== null && (u.value !== '' || cur.value)) {
    const v = Math.max(0, Math.round(Number(String(u.value).replace(/[^0-9.]/g, '')) || 0));
    if (v !== (Number(cur.value) || 0)) { cur.value = v; add.push({ kind: 'value', value: v }); }
  }
  if (u.next !== undefined && u.next !== null) {
    const text = clean(u.next.text, 200), due = clean(u.next.due, 10);
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Invalid: pick a date for the next step');
    const old = cur.next || {};
    if (text !== (old.text || '') || due !== (old.due || '')) { cur.next = text ? { text, due } : null; add.push(text ? { kind: 'next', text, due } : { kind: 'next-done', text: old.text || '' }); }
  }
  // Name, phone and company typed in by the team win over what Calendly or the sheets say.
  if (u.contact && typeof u.contact === 'object') {
    [['name', 'Name', 160], ['phone', 'Phone', 40], ['email', 'Email', 200], ['company', 'Company', 160]].forEach(([k, label, max]) => {
      if (u.contact[k] === undefined || u.contact[k] === null) return;
      const v = k === 'email' ? emailIn(u.contact[k]) : clean(u.contact[k], max);
      if (k === 'email' && clean(u.contact[k], 200) && !v) throw new Error('Invalid: that email address does not look right');
      if (k === 'name' && !v) return;
      if (v !== (cur[k] || '')) { cur[k] = v; add.push({ kind: 'edit', text: label + (v ? ' changed to ' + v : ' cleared') }); }
    });
  }
  const note = clean(String(u.note || '').replace(/\r/g, ''), 4000);
  if (note) add.push({ kind: 'note', text: String(u.note).replace(/\r/g, '').trim().slice(0, 4000) });
  if (!add.length) return { ok: true, changed: 0 };
  add.forEach(x => trail.push(Object.assign({ id: crypto.randomBytes(5).toString('hex'), at, by: who }, x)));
  await P([['HSET', 'pl:leadov', key, JSON.stringify(cur)], ['HSET', 'pl:trail', key, JSON.stringify(trail.slice(-TRAIL_MAX))]]);
  return { ok: true, changed: add.length };
}
// A lead met outside Calendly and the Lead Entry sheets (a call, WhatsApp, a referral). It goes straight to Shown.
// A lead added by hand, at any stage: Booked or No-show (with the meeting date), Showed, Not replying, Unqualified or Won.
const ADD_STAGES = ['booked', 'shown', 'no_show', 'no_reply', 'unqualified', 'won'];
async function addManualLead(x = {}, by = '') {
  const name = clean(x.name, 160); if (!name) throw new Error('Invalid: enter a name');
  const stage = ADD_STAGES.includes(x.stage) ? x.stage : 'shown';
  let meetingAt = '';
  if (stage === 'booked' || stage === 'no_show') {
    const t = Date.parse(x.meetingAt);
    if (isNaN(t)) { if (stage === 'booked') throw new Error('Invalid: pick the meeting date and time'); }
    else meetingAt = new Date(t).toISOString();
    if (stage === 'no_show' && !meetingAt) meetingAt = new Date().toISOString();
  }
  const rec = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), name, company: clean(x.company, 160), email: emailIn(x.email), phone: clean(x.phone, 40), country: clean(x.country, 60), type: x.type === 'inbound' ? 'inbound' : 'outbound', by: clean(by, 60) };
  if (meetingAt) rec.meetingAt = meetingAt;
  const key = rec.email ? 'e:' + rec.email : 'n:' + slug(rec.name) + '|' + slug(rec.company);
  const cmds = [['HSET', 'pl:manual', rec.id, JSON.stringify(rec)]];
  if (stage === 'no_show') cmds.push(['HSET', 'pl:outcomes', 'h_' + rec.id, JSON.stringify({ outcome: 'no_show', at: Date.now() })]);
  await P(cmds);
  const deal = stage === 'shown' || stage === 'won' ? stage : stage === 'no_reply' || stage === 'unqualified' ? 'dead' : '';
  const u = { note: x.note };
  if (deal) { u.deal = deal; u.from = 'new'; if (deal === 'dead') u.reason = stage; }
  if (deal || x.note) await updateLead(key, u, by);
  return { ok: true, key, stage };
}
// Brings in an earlier follow-up trail (for example from a Google Sheet), keeping each line's own date.
async function importNotes(key, list = [], by = '', also) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await absorb(key, also);
  const [rawT] = await P([['HGET', 'pl:trail', key]]);
  const trail = Array.isArray(parseJSON(rawT)) ? parseJSON(rawT) : [];
  const seen = new Set(trail.map(x => x.at + '|' + x.text));
  let added = 0;
  (Array.isArray(list) ? list : []).slice(0, 200).forEach(n => {
    const at = Number(n.at) || Date.parse(n.at); const text = String(n.text || '').trim().slice(0, 4000);
    if (!at || isNaN(at) || !text || seen.has(at + '|' + text)) return;
    seen.add(at + '|' + text); trail.push({ id: crypto.randomBytes(5).toString('hex'), at, by: clean(n.by || by, 60) || 'Imported', kind: 'note', text }); added++;
  });
  trail.sort((a, b) => a.at - b.at);
  await P([['HSET', 'pl:trail', key, JSON.stringify(trail.slice(-TRAIL_MAX))]]);
  return { ok: true, added };
}
async function deleteNote(key, id, also) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await absorb(key, also);
  const [rawT] = await P([['HGET', 'pl:trail', key]]);
  const trail = Array.isArray(parseJSON(rawT)) ? parseJSON(rawT) : [];
  const next = trail.filter(x => !(x.id === id && x.kind === 'note'));
  if (next.length === trail.length) throw new Error('Unknown note');
  await P([['HSET', 'pl:trail', key, JSON.stringify(next)]]);
  return { ok: true };
}

// Deleting a lead hides it everywhere (it can be brought back from Sources). Its notes are kept.
async function deleteLead(key, x = {}, by = '') {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await P([['HSET', 'pl:hidden', key, JSON.stringify({ at: Date.now(), by: clean(by, 60) || 'Admin', name: clean(x.name, 160), company: clean(x.company, 160) })]]);
  return { ok: true };
}
async function restoreLead(key) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await P([['HDEL', 'pl:hidden', key]]);
  return { ok: true };
}
// A follow-up email to a lead, sent through Brevo (the same account as the website follow-ups).
// It goes out from success@bpohive.com with the sender's name, and replies go to the sender's own inbox.
const TEAM_MAIL = /^[^\s@]+@(bpohive\.com|bpo-outsourcing-services\.com)$/i;
async function sendLeadEmail(key, x = {}, by = '', also) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  if (!process.env.BREVO_API_KEY) throw new Error('Email is not set up: add BREVO_API_KEY in Vercel.');
  const to = emailIn(x.to); if (!to) throw new Error('Invalid: add the lead\'s email address first');
  const subject = clean(x.subject, 200); if (!subject) throw new Error('Invalid: write a subject');
  const body = String(x.body || '').replace(/\r/g, '').trim().slice(0, 10000); if (!body) throw new Error('Invalid: write the message');
  const replyTo = emailIn(x.replyTo); if (!replyTo || !TEAM_MAIL.test(replyTo)) throw new Error('Invalid: pick who replies go to');
  const fromName = clean(x.fromName || by, 80) || 'BPO Hive';
  const cc = (Array.isArray(x.cc) ? x.cc : String(x.cc || '').split(/[,;\s]+/)).map(emailIn).filter(Boolean).slice(0, 5);
  // Files attached in the CRM (sent to Brevo as base64). Up to 5 files and about 3 MB in total.
  const files = (Array.isArray(x.attachments) ? x.attachments : []).slice(0, 5).map(a => ({ name: clean(a && a.name, 120).replace(/[\\/:*?"<>|]+/g, '-'), content: String((a && a.content) || '').replace(/^data:[^,]*,/, '') })).filter(a => a.name && a.content);
  if ((Array.isArray(x.attachments) ? x.attachments : []).length > 5) throw new Error('Invalid: attach up to 5 files');
  const bytes = files.reduce((n, a) => n + Math.floor(a.content.length * 3 / 4), 0);
  if (bytes > 3 * 1024 * 1024) throw new Error('Invalid: attachments are too big (3 MB in total at most)');
  if (files.some(a => !/^[A-Za-z0-9+/=\s]+$/.test(a.content))) throw new Error('Invalid: an attachment could not be read');
  if (files.some(a => !/\.(pdf|docx?|xlsx?|pptx?|csv|txt|png|jpe?g|gif|zip|rtf|odt|ods|odp)$/i.test(a.name))) throw new Error('Invalid: this file type cannot be attached (use PDF, Word, Excel, PowerPoint, CSV, images or ZIP)');
  const bcc = x.copy === false || x.copy === 'false' ? [] : [replyTo].filter(e => !cc.includes(e) && e !== to);
  const escH = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = '<div style="font:15px/1.6 Arial,sans-serif;color:#20292F">' + body.split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + escH(p).replace(/\n/g, '<br>') + '</p>').join('') + '</div>';
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(Object.assign({ sender: { name: fromName + ' | BPO Hive', email: process.env.FOLLOWUP_FROM || 'success@bpohive.com' }, replyTo: { email: replyTo, name: fromName },
      to: [{ email: to, name: clean(x.toName, 120) || undefined }], subject, htmlContent: html, textContent: body, tags: ['crm-follow-up'] }, cc.length ? { cc: cc.map(e => ({ email: e })) } : {}, bcc.length ? { bcc: bcc.map(e => ({ email: e })) } : {}, files.length ? { attachment: files } : {})),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error('The email was not sent (Brevo ' + r.status + '): ' + (await r.text()).slice(0, 160));
  await absorb(key, also);
  const [rawT] = await P([['HGET', 'pl:trail', key]]);
  const trail = Array.isArray(parseJSON(rawT)) ? parseJSON(rawT) : [];
  trail.push({ id: crypto.randomBytes(5).toString('hex'), at: Date.now(), by: clean(by, 60) || fromName, kind: 'email', to, subject, text: body.slice(0, 4000), replyTo, cc, copyTo: bcc[0] || '', files: files.map(a => a.name) });
  await P([['HSET', 'pl:trail', key, JSON.stringify(trail.slice(-TRAIL_MAX))]]);
  return { ok: true };
}
async function setLead(key, patch, also) {
  if (!/^[en]:.{1,400}$/.test(String(key))) throw new Error('Unknown lead');
  await absorb(key, also);
  const [raw] = await P([['HGET', 'pl:leadov', key]]);
  const cur = parseJSON(raw) || {};
  if (patch.stage !== undefined) { if (patch.stage && !STAGES.includes(patch.stage)) throw new Error('Unknown stage'); cur.stage = patch.stage || ''; }
  if (patch.type !== undefined) { if (patch.type && !['inbound', 'outbound'].includes(patch.type)) throw new Error('Unknown type'); cur.type = patch.type || ''; }
  if (patch.note !== undefined) cur.note = clean(patch.note, 4000);
  await P([['HSET', 'pl:leadov', key, JSON.stringify(cur)]]);
  return { ok: true };
}

module.exports = {
  setSince, snapshot, syncCalendly, syncFathom, slimRecording, saveSheets, getSources, setSources, setSkippedEvents, webBooking, updateLead, sendLeadEmail, deleteNote, deleteLead, restoreLead, addManualLead, importNotes, TEMPS, mergeOv, mergeTrails, phoneKey, DEALS, sheetIdOf, apptTime, sheetOutcome, TZS, verifyGoogleToken, setOutcome, setLead, build, readTab, callerFromTitle, effectiveOutcome, calendlyOn,
  _setPipe: f => { _pipe = f; }, _setCerts: keys => { certCache = { keys, exp: Date.now() + 3600e3 }; }
};
