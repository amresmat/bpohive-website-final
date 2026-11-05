const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
process.env.KV_REST_API_URL = 'http://fake'; process.env.KV_REST_API_TOKEN = 'x'; process.env.ADMIN_PASSWORD = 'pw';
const S = new Map(), Z = new Map(), SETS = new Map(), H = new Map(), L = new Map();
const num = v => Number(v) || 0;
function cmd(c) { const [op, k, ...a] = c; switch (op) {
  case 'GET': return S.has(k) ? S.get(k) : null;
  case 'SET': { if (a.includes('NX') && S.has(k)) return null; S.set(k, a[0]); return 'OK'; }
  case 'DEL': return S.delete(k) ? 1 : 0;
  case 'MGET': return [k, ...a].map(x => S.has(x) ? S.get(x) : null);
  case 'ZADD': { const z = Z.get(k) || new Map(); Z.set(k, z); z.set(a[1], num(a[0])); return 1; }
  case 'ZRANGE': { const z = [...(Z.get(k) || new Map())].sort((x, y) => x[1] - y[1]).map(x => x[0]); const e = num(a[1]); return z.slice(num(a[0]), e < 0 ? z.length + e + 1 : e + 1); }
  case 'SMEMBERS': return [...(SETS.get(k) || [])];
  case 'SADD': { const s = SETS.get(k) || new Set(); SETS.set(k, s); a.forEach(x => s.add(x)); return 1; }
  case 'HGETALL': { const h = H.get(k); return h ? [...h].flat() : []; }
  case 'HGET': { const h = H.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
  case 'HSET': { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], a[1]); return 1; }
  case 'HDEL': { const h = H.get(k); return h && h.delete(a[0]) ? 1 : 0; }
  case 'LRANGE': { const l = L.get(k) || []; const e = num(a[1]); return l.slice(num(a[0]), e < 0 ? l.length : e + 1); }
  default: throw new Error('unsupported ' + op); } }

const now = Date.now(), iso = ms => new Date(ms).toISOString();
const calls = [];
const EVENTS = [
  { uri: 'https://api.calendly.com/scheduled_events/EV1', name: 'Discovery call', status: 'active', start_time: iso(now - 2 * 864e5), end_time: iso(now - 2 * 864e5 + 1800e3), created_at: iso(now - 5 * 864e5), updated_at: 'u1', event_memberships: [{ user_name: 'Abdullah H.' }] },
  { uri: 'https://api.calendly.com/scheduled_events/EV2', name: 'Discovery call', status: 'active', start_time: iso(now + 864e5), end_time: iso(now + 864e5 + 1800e3), created_at: iso(now - 864e5), updated_at: 'u2', event_memberships: [] },
  { uri: 'https://api.calendly.com/scheduled_events/EV3', name: 'Discovery call', status: 'canceled', start_time: iso(now - 864e5), end_time: iso(now - 864e5 + 1800e3), created_at: iso(now - 3 * 864e5), updated_at: 'u3', event_memberships: [] }
];
const INVITEES = {
  EV1: [{ uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/I1', name: 'Cenk Temiz', email: 'cenk@portel.com', status: 'active', created_at: iso(now - 5 * 864e5), questions_and_answers: [{ question: 'Company name', answer: 'Portel' }], no_show: null }],
  EV2: [{ uri: 'https://api.calendly.com/scheduled_events/EV2/invitees/I2', name: 'Jane Cooper', email: 'jane@northwind.io', status: 'active', created_at: iso(now - 864e5), questions_and_answers: [], no_show: null, tracking: { utm_source: 'linkedin' } }],
  EV3: [{ uri: 'https://api.calendly.com/scheduled_events/EV3/invitees/I3', name: 'Sam Ray', email: 'sam@globex.com', status: 'canceled', created_at: iso(now - 3 * 864e5), questions_and_answers: [], no_show: null, rescheduled: true }]
};
global.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith('http://fake')) { const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map(c => ({ result: cmd(c) })) }; }
  calls.push([opt.method || 'GET', url, opt.body ? JSON.parse(opt.body) : null]);
  const json = o => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
  if (url.endsWith('/users/me')) return json({ resource: { uri: 'https://api.calendly.com/users/ME', current_organization: 'https://api.calendly.com/organizations/ORG', name: 'Amr' } });
  if (url.includes('/scheduled_events?')) return json({ collection: EVENTS, pagination: { next_page: null } });
  const m = url.match(/scheduled_events\/(EV\d)\/invitees/); if (m) return json({ collection: INVITEES[m[1]] });
  if (url.endsWith('/invitee_no_shows')) return json({ resource: { uri: 'https://api.calendly.com/invitee_no_shows/NS1' } });
  if (url.startsWith('https://api.fathom.ai/external/v1/meetings')) {
    assert.equal(opt.headers['X-Api-Key'], 'fk');
    return json({ next_cursor: null, items: [
      { recording_id: 501, title: 'BPO Hive x Northwind', share_url: 'https://fathom.video/share/abc', scheduled_start_time: iso(now + 864e5), recording_start_time: iso(now + 864e5 + 60e3), created_at: iso(now), recorded_by: { name: 'Abdullah H.', email: 'abdullah@bpohive.com' },
        calendar_invitees: [{ name: 'Abdullah H.', email: 'abdullah@bpohive.com', is_external: false }, { name: 'Jane Cooper', email: 'jane@northwind.io', is_external: true }],
        transcript: [{ speaker: { display_name: 'Abdullah H.' }, text: 'Hi' }, { speaker: { display_name: 'Jane Cooper', matched_calendar_invitee_email: 'jane@northwind.io' }, text: 'Hello' }],
        default_summary: { markdown_formatted: '## Summary\nWants 20 meetings a month.' }, action_items: [{ description: 'Send proposal' }] },
      { recording_id: 502, title: 'Waiting room', scheduled_start_time: iso(now - 864e5), created_at: iso(now), recorded_by: { name: 'Amr' },
        calendar_invitees: [{ name: 'Stranger', email: 'x@unknown.com', is_external: true }], transcript: [{ speaker: { display_name: 'Amr' }, text: 'Hello?' }] }
    ] });
  }
  return { ok: false, status: 404, text: async () => '{}' };
};
const pl = require('../lib/pipeline.cjs');

test('sheet tabs are read by their headers, wherever the columns are', () => {
  const rows = pl.readTab([['Timestamp', 'Name', 'Title', 'Company', 'Campaign', 'Latest Update', 'Update Trail', 'Number'],
    ['05 Nov 2026 08:06', 'Cenk Temiz', 'CEO', 'Portel', 'BPO Hive', 'Booked a meeting', '05 Nov – Booked', 'cenk@portel.com'],
    ['', '', '', '', '', '', '', ''], ['16 Oct 2026 22:39', 'Matt LeBlanc', 'Owner', 'El Pollo Guapo', 'Max', 'Not interested', '', '1 860 246 2800']]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, 'cenk@portel.com'); assert.equal(rows[0].campaign, 'BPO Hive');
  assert.equal(rows[1].phone, '1 860 246 2800'); assert.equal(rows[1].email, '');
  assert.equal(pl.callerFromTitle('Hot Leads Juwayriya'), 'Juwayriya');
  assert.equal(pl.callerFromTitle('Hot Leads Internal Sales Zeina'), 'Zeina');
});

test('only signed tokens from our Google accounts can push sheets', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
  pl._setCerts([jwk]);
  const sign = claims => { const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url'); const p = Buffer.from(JSON.stringify(claims)).toString('base64url'); return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url'); };
  const good = { iss: 'https://accounts.google.com', email: 'amr@bpohive.com', email_verified: true, exp: Math.floor(now / 1000) + 600 };
  assert.equal(await pl.verifyGoogleToken(sign(good)), 'amr@bpohive.com');
  await assert.rejects(pl.verifyGoogleToken(sign(Object.assign({}, good, { email: 'someone@gmail.com' }))), /not allowed/);
  await assert.rejects(pl.verifyGoogleToken(sign(Object.assign({}, good, { exp: Math.floor(now / 1000) - 3600 }))), /expired/);
  const forged = sign(good).split('.'); forged[1] = Buffer.from(JSON.stringify(Object.assign({}, good, { email: 'info@bpohive.com' }))).toString('base64url');
  await assert.rejects(pl.verifyGoogleToken(forged.join('.')), /signature/);
});

test('website, sheets and Calendly merge into one pipeline; outcomes sync to Calendly', async () => {
  process.env.CALENDLY_TOKEN = 'cal';
  L.set('entries', [JSON.stringify({ id: 'e1', form: 'Build my campaign', at: iso(now - 2 * 864e5), page: 'https://www.bpohive.com/', fields: { name: 'Jane Cooper', email: 'jane@northwind.io', company: 'Northwind' } })]);
  await pl.saveSheets({ sheets: [{ id: '19r0AwkMBJlcrQEL9vZ5wtUDHxsJ-XDiTQhrwf2mX5HY', title: 'Hot Leads Juwayriya', tab: 'Hot Leads', rows: [['Timestamp', 'Name', 'Title', 'Company', 'Campaign', 'Latest Update', 'Update Trail'], [new Date(now - 6 * 864e5).toUTCString(), 'Cenk Temiz', 'CEO', 'Portel', 'BPO Hive', 'Booked a meeting', 'Booked']] }] }, 'amr@bpohive.com');
  const snap = await pl.snapshot();
  assert.equal(snap.status.calendly.connected, true); assert.equal(snap.meetings.length, 3);
  const cenk = snap.leads.find(l => l.name === 'Cenk Temiz');
  assert.equal(cenk.type, 'outbound'); assert.deepEqual(cenk.callers, ['Juwayriya']); assert.equal(cenk.stage, 'needs'); assert.equal(cenk.meetings.length, 1);
  const jane = snap.leads.find(l => l.email === 'jane@northwind.io');
  assert.equal(jane.type, 'inbound'); assert.equal(jane.stage, 'booked'); assert.equal(jane.company, 'Northwind');
  assert.equal(snap.meetings.find(m => m.id === 'EV3').outcome, 'rescheduled');
  // mark no-show -> Calendly gets flagged
  await pl.setOutcome('EV1', 'no_show');
  assert.ok(calls.find(c => c[0] === 'POST' && c[1].endsWith('/invitee_no_shows') && c[2].invitee.endsWith('/I1')));
  let s2 = await pl.snapshot({ sync: false });
  assert.equal(s2.meetings.find(m => m.id === 'EV1').outcome, 'no_show'); assert.equal(s2.leads.find(l => l.name === 'Cenk Temiz').stage, 'no_show');
  // then showed -> the Calendly no-show is removed
  await pl.setOutcome('EV1', 'showed');
  assert.ok(calls.find(c => c[0] === 'DELETE' && c[1].endsWith('/invitee_no_shows/NS1')));
  await pl.setLead(cenk.key, { stage: 'won', note: 'Signed the validation sprint' });
  s2 = await pl.snapshot({ sync: false });
  const c2 = s2.leads.find(l => l.name === 'Cenk Temiz');
  assert.equal(c2.stage, 'won'); assert.equal(c2.note, 'Signed the validation sprint');
  await assert.rejects(pl.setOutcome('EV1', 'maybe'), /Unknown/);
});

test('Fathom recordings attach to the lead and mark the meeting as showed when the prospect spoke', async () => {
  process.env.FATHOM_API_KEY = 'fk';
  const solo = pl.slimRecording({ recording_id: 1, calendar_invitees: [{ name: 'P Q', email: 'p@q.com', is_external: true }], recorded_by: { name: 'Amr' }, transcript: [{ speaker: { display_name: 'Amr' } }] });
  assert.equal(solo.externalSpoke, false);
  const r = await pl.syncFathom({ force: true });
  assert.equal(r.saved, 2); assert.equal(r.backfilled, true);
  const snap = await pl.snapshot({ sync: false });
  const jane = snap.leads.find(l => l.email === 'jane@northwind.io');
  assert.equal(jane.recordings.length, 1); assert.equal(jane.recordings[0].url, 'https://fathom.video/share/abc');
  assert.deepEqual(jane.recordings[0].actions, ['Send proposal']);
  const m = snap.meetings.find(x => x.id === 'EV2');
  assert.equal(m.fathom.id, '501'); assert.equal(m.outcome, 'showed'); assert.equal(m.viaFathom, true);
  assert.equal(snap.status.fathom.unlinked, 1);
  // a manual mark still wins over Fathom
  await pl.setOutcome('EV2', 'rescheduled');
  const s2 = await pl.snapshot({ sync: false });
  assert.equal(s2.meetings.find(x => x.id === 'EV2').outcome, 'rescheduled');
});
