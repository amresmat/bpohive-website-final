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
  case 'SREM': { const st = SETS.get(k); return st && st.delete(a[0]) ? 1 : 0; }
  case 'SADD': { const s = SETS.get(k) || new Set(); SETS.set(k, s); a.forEach(x => s.add(x)); return 1; }
  case 'HGETALL': { const h = H.get(k); return h ? [...h].flat() : []; }
  case 'HGET': { const h = H.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
  case 'HSET': { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], a[1]); return 1; }
  case 'HDEL': { const h = H.get(k); return h ? a.filter(f => h.delete(f)).length : 0; }
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

test('Lead Entry sheets are read by their headers; appointment times use the right time zone', () => {
  const H1 = ['Timestamp', 'Vertical Type', 'Prospect Name', 'Business Name', ' Prospect Title/Position', 'Agent Name', 'Appointment Date', 'Appointment Time', 'Timezone', 'Prospect Email', 'Prospect Phone Number USE FORMAT (000) 000-0000 ONLY', 'Call Recording Link', 'Call notes', 'Variable question', 'Prospect Phone 2', 'Location / Address', 'Call Recording Link 2', 'Confirmation Status', 'Pre-Meeting Follow-up', 'Show Status'];
  const rows = pl.readTab([H1,
    ['10/30/2026 18:52:30', '', 'Jacob Morley', 'AutoManager', 'CEO', 'Shayen', '10/30/2026', '3:30:00 PM', 'EST', 'jake@automanager.com', '+1 315 854 2187', 'https://rec/1', 'Wants more sales', '', '', '', '', 'Confirmed', '', 'Showed Up'],
    ['9/14/2026 14:29', 'GCC - General', 'Mohammad Ammar', 'Robert Walters', 'Head of BD', 'Joy', 'Thu, Sep 10, 2026', '2:00 PM', '', '', '+966560641222', 'https://rec/2', 'Interested', '', '', '', '', '', '', 'No-Show']]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].caller, 'Shayen'); assert.equal(rows[0].email, 'jake@automanager.com'); assert.equal(rows[0].phone, '+1 315 854 2187'); assert.equal(rows[0].recording, 'https://rec/1'); assert.equal(rows[0].show, 'Showed Up'); assert.equal(rows[0].confirm, 'Confirmed');
  assert.equal(rows[1].title, 'Head of BD'); assert.equal(rows[1].vertical, 'GCC - General');
  assert.equal(new Date(pl.apptTime('10/30/2026', '3:30:00 PM', 'EST', 'Asia/Dubai')).toISOString(), '2026-10-30T19:30:00.000Z'); // EDT that day
  assert.equal(new Date(pl.apptTime('Thu, Sep 10, 2026', '2:00 PM', '', 'Asia/Dubai')).toISOString(), '2026-09-10T10:00:00.000Z');
  assert.equal(new Date(pl.apptTime('11/11/2026', '12:00:00 PM', '', 'America/New_York')).toISOString(), '2026-11-11T17:00:00.000Z');
  assert.equal(pl.sheetOutcome('Showed Up'), 'showed'); assert.equal(pl.sheetOutcome('No-Show'), 'no_show'); assert.equal(pl.sheetOutcome(''), '');
  assert.equal(pl.sheetIdOf('https://docs.google.com/spreadsheets/d/18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0/edit#gid=1'), '18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0');
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
  const d = new Date(now - 2 * 864e5), mdy = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  const later = new Date(now + 3 * 864e5), mdy2 = (later.getUTCMonth() + 1) + '/' + later.getUTCDate() + '/' + later.getUTCFullYear();
  const HDR = ['Timestamp', 'Prospect Name', 'Business Name', 'Prospect Title/Position', 'Agent Name', 'Appointment Date', 'Appointment Time', 'Timezone', 'Prospect Email', 'Call Recording Link', 'Confirmation Status', 'Show Status'];
  const t = s => new Date(now - 6 * 864e5).toUTCString();
  const r = await pl.saveSheets({ sheets: [
    { id: '18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0', title: 'BPO Hive USA Lead Entry Form (Responses)', tab: 'Form Responses 1', rows: [HDR,
      [t(), 'Cenk Temiz', 'Portel', 'CEO', 'Juwayriya', iso(now - 2 * 864e5).slice(0, 10), new Date(now - 2 * 864e5).toISOString().slice(11, 16), 'UTC', 'cenk@portel.com', 'https://rec/c', 'Confirmed', ''],
      [t(), 'Lena Ford', 'Fordwise', 'COO', 'Shayen', mdy2, '10:00 AM', 'EST', 'lena@fordwise.com', '', '', ''],
      [t(), 'Omar Said', 'Saidco', 'GM', 'Shayen', mdy, '9:00 AM', '', '', '', '', 'No-Show']] },
    { id: '1Ebdfps1QC1LY_GD7_48Uk8RjhCxXTMGFazDiOq50iEc', title: 'Hot Leads Shayen', tab: 'Hot Leads', rows: [['Name', 'Company'], ['Not Allowed', 'X']] }] }, 'amr@bpohive.com');
  assert.equal(r.files.length, 1, 'sheets not listed in Sources are ignored');
  const snap = await pl.snapshot();
  assert.equal(snap.status.calendly.connected, true); assert.equal(snap.meetings.length, 5);
  const cenk = snap.leads.find(l => l.name === 'Cenk Temiz');
  assert.equal(cenk.type, 'outbound'); assert.deepEqual(cenk.callers, ['Juwayriya']); assert.deepEqual(cenk.campaigns, ['BPO Hive USA']); assert.equal(cenk.stage, 'needs'); assert.equal(cenk.meetings.length, 1, 'sheet appointment joins the Calendly meeting at the same time');
  const ev1 = snap.meetings.find(m => m.id === 'EV1'); assert.equal(ev1.sheet.recording, 'https://rec/c'); assert.equal(ev1.sheet.confirm, 'Confirmed');
  const omar = snap.meetings.find(m => m.invitee.name === 'Omar Said'); assert.equal(omar.kind, 'sheet'); assert.equal(omar.outcome, 'no_show'); assert.equal(omar.viaSheet, true);
  assert.equal(snap.meetings.find(m => m.invitee.name === 'Lena Ford').outcome, 'upcoming');
  await pl.setOutcome(omar.id, 'showed');
  assert.equal((await pl.snapshot({ sync: false })).meetings.find(m => m.id === omar.id).outcome, 'showed', 'a mark in the Pipeline wins over the sheet');
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

test('Sources can be changed in the admin; links are turned into sheet IDs', async () => {
  const out = await pl.setSources([{ name: 'BPO Hive USA', url: 'https://docs.google.com/spreadsheets/d/18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0/edit', tz: 'America/New_York' }, { name: 'New GCC', url: 'https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/edit', tz: 'Asia/Riyadh' }]);
  assert.deepEqual(out.map(x => x.id), ['18SdZiU_9y5lI2eYLzwWX-NS1rx2nYV2DukvgbV74eQ0', '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']);
  await assert.rejects(pl.setSources([{ name: 'x', url: 'not a link' }]), /Unknown/);
});

test('team members sign in with their own password and only see their own leads', async () => {
  const team = require('../lib/team.cjs');
  const handler = require('../api/admin/pipeline.js');
  const login = require('../api/admin/login.js');
  const call = async (fn, { method = 'GET', body, cookie = '', query = {} } = {}) => { const out = { headers: {} }; const res = { status(c) { out.status = c; return res; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, json(o) { out.body = o; }, end() {} }; await fn({ method, body, query, headers: { cookie } }, res); return out; };
  const { user, token } = await team.addUser({ name: 'Shayen R', email: 'Shayen@Example.com', agents: 'Shayen' });
  assert.equal(user.status, 'invited');
  await assert.rejects(team.addUser({ name: 'Dup', email: 'shayen@example.com' }), /already/);
  assert.equal((await call(login, { method: 'POST', body: { invite: token, password: 'short' } })).status, 400);
  const ok = await call(login, { method: 'POST', body: { invite: token, password: 'goodpassword1' } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers['set-cookie'].split(';')[0];
  assert.equal((await call(login, { method: 'POST', body: { invite: token, password: 'goodpassword1' } })).status, 400, 'an invite works once');
  assert.equal((await call(login, { method: 'POST', body: { email: 'shayen@example.com', password: 'wrong-pass' } })).status, 401);
  assert.equal((await call(login, { method: 'POST', body: { email: 'shayen@example.com', password: 'goodpassword1' } })).status, 200);
  const view = await call(handler, { cookie, query: { sync: '0' } });
  assert.equal(view.status, 200); assert.equal(view.body.role, 'caller');
  assert.ok(view.body.leads.length >= 2); assert.ok(view.body.leads.every(l => l.callers.includes('Shayen')));
  assert.ok(view.body.meetings.every(m => view.body.leads.some(l => l.key === m.leadKey)));
  assert.equal(view.body.sources, undefined); assert.equal(view.body.team, undefined);
  assert.equal((await call(handler, { method: 'POST', cookie, body: { action: 'outcome', id: 'EV1', outcome: 'showed' } })).status, 403, 'callers are read-only');
  assert.equal((await call(require('../api/admin/entries.js'), { cookie })).status, 401, 'callers cannot open the rest of the admin');
  // a new invite link signs them out
  await team.reinvite(user.id);
  assert.equal((await call(handler, { cookie, query: { sync: '0' } })).status, 401);
});

test('a lead keeps how they first came in; follow-ups are numbered; non-sales Calendly events are left out', () => {
  const day = 864e5;
  const mt = (id, name, start, inv, status = 'active') => ({ id, name, start: iso(start), end: iso(start + 1800e3), status, created: iso(start - 2 * day), invitees: [Object.assign({ qa: [], utm: {}, created: iso(start - 2 * day) }, inv)] });
  const data = () => ({
    entries: [{ id: 'c1', form: 'Calendly booking', at: iso(now - 9 * day), fields: { email: 'pop@site.com', company: 'Popco' } }],
    sheets: [{ id: 'S1', name: 'BPO Hive USA', rows: [{ at: iso(now - 40 * day), name: 'Shamez Foster', company: 'Best Choice Roofing', email: 's.foster@bestchoice.com', caller: 'Shayen' }] }],
    meetings: [
      mt('A1', 'Discovery Call', now - 30 * day, { name: 'Shamez Foster', email: 's.foster@bestchoice.com' }),
      mt('A2', 'Discovery Call', now - 25 * day, { name: 'Shamez Foster', email: 's.foster@bestchoice.com', rescheduled: true }, 'canceled'),
      mt('A3', 'BPO Hive Discovery Call', now - 20 * day, { name: 'Shamez Foster', email: 's.foster@bestchoice.com', utm: { source: 'bpohive.com', medium: 'website' } }),
      mt('B1', 'BPO Hive Discovery Call', now + 4 * day, { name: 'Jack Foster', email: 'jack@crg123.com', qa: [{ q: 'Company name', a: 'Center Realty Group' }] }),
      mt('C1', 'Discovery Call', now + 2 * day, { name: 'Web Person', email: 'web@acme.com', utm: { source: 'bpohive.com', medium: 'website', campaign: 'strategy_call' } }),
      mt('D1', 'Discovery Call', now - 8 * day, { name: 'Pop Up', email: 'pop@site.com' }),
      mt('E1', 'Discovery Call', now - 6 * day, { name: 'Mail Lead', email: 'mail@lead.com', utm: { source: 'salesfinity', medium: 'email' } }),
      mt('I1', 'Interviews BPO Hive', now - 3 * day, { name: 'Job Seeker', email: 'job@gmail.com' })
    ],
    leadOv: {}, recordings: [], outcomes: {}, skipEvents: null
  });
  const r = pl.build(data());
  const lead = e => r.leads.find(l => l.email === e);
  const sh = lead('s.foster@bestchoice.com');
  assert.equal(sh.type, 'outbound', 'a later booking from the website does not turn an outbound lead inbound');
  assert.equal(sh.origin, 'Lead Entry sheet');
  assert.deepEqual(['A1', 'A2', 'A3'].map(id => r.meetings.find(m => m.id === id).seq), [1, 0, 2], 'the cancelled one is not counted');
  const jack = lead('jack@crg123.com');
  assert.equal(jack.type, 'outbound', 'booked through a Calendly link the team sent'); assert.equal(jack.origin, 'Calendly link (not from the website)');
  assert.equal(lead('web@acme.com').type, 'inbound'); assert.equal(lead('web@acme.com').origin, 'Booked on the website');
  assert.equal(lead('pop@site.com').type, 'inbound', 'booked in the website pop-up');
  assert.equal(lead('mail@lead.com').type, 'outbound', 'utm from an email sequence is not the website');
  assert.equal(r.meetings.find(m => m.id === 'B1').type, 'outbound');
  assert.ok(!lead('job@gmail.com') && !r.meetings.find(m => m.id === 'I1'), 'interviews are left out');
  assert.deepEqual(r.eventTypes.find(e => e.name === 'Interviews BPO Hive'), { name: 'Interviews BPO Hive', meetings: 1, skipped: true });
  const r2 = pl.build(Object.assign(data(), { skipEvents: ['BPO Hive Discovery Call'] }));
  assert.ok(r2.meetings.find(m => m.id === 'I1') && !r2.meetings.find(m => m.id === 'B1'), 'the saved list replaces the default');
  const r3 = pl.build(Object.assign(data(), { leadOv: { 'e:jack@crg123.com': { type: 'inbound' } } }));
  assert.equal(r3.leads.find(l => l.email === 'jack@crg123.com').type, 'inbound', 'a type set by hand wins');
});

test('the event-types setting is saved and used', async () => {
  await pl.setSkippedEvents(['Vendor Meeting', ' Vendor Meeting ', '']);
  assert.equal(S.get('pl:evskip'), JSON.stringify(['Vendor Meeting']));
  await assert.rejects(pl.setSkippedEvents('x'), /Unknown/);
  assert.equal(pl.webBooking({ source: 'bpohive.com', medium: 'website' }), true);
  assert.equal(pl.webBooking({}), false);
  S.delete('pl:evskip');
});

test('shown / dead: a show goes to Shown and stays there; dead when unqualified or not replying', async () => {
  const day = 864e5;
  const mt = (id, start, inv, outcome, created) => ({ id, name: 'Discovery Call', start: iso(start), end: iso(start + 1800e3), status: 'active', created: iso(created || start - 2 * day), invitees: [Object.assign({ qa: [], utm: {}, created: iso(start - 2 * day) }, inv)], override: outcome ? { outcome } : null });
  const base = { entries: [], sheets: [], recordings: [], outcomes: {}, skipEvents: null, leadOv: {}, trails: {},
    meetings: [mt('M1', now - 10 * day, { name: 'Ann Lee', email: 'ann@a.com' }, 'showed'), mt('M2', now + 2 * day, { name: 'Ann Lee', email: 'ann@a.com' }),
      mt('M3', now - 5 * day, { name: 'Bo Kim', email: 'bo@b.com' }, 'showed'), mt('M4', now - 3 * day, { name: 'Cy Ray', email: 'cy@c.com' }, 'no_show'),
      mt('M5', now + 1 * day, { name: 'Di Fox', email: 'di@d.com' }), mt('M6', now - 1 * day, { name: 'Ed Wu', email: 'ed@e.com' })] };
  const g = (r, e) => r.leads.find(l => l.email === e);
  let r = pl.build(JSON.parse(JSON.stringify(base)));
  assert.equal(g(r, 'ann@a.com').status, 'shown', 'a follow-up booked after a show stays in Shown');
  assert.equal(g(r, 'bo@b.com').status, 'shown'); assert.equal(g(r, 'bo@b.com').dealAuto, true);
  assert.equal(g(r, 'cy@c.com').status, 'no_show'); assert.equal(g(r, 'di@d.com').status, 'booked'); assert.equal(g(r, 'ed@e.com').status, 'to_mark');
  await pl.updateLead('e:bo@b.com', { note: 'Called, no answer', next: { text: 'Call again', due: '2026-11-12' } }, 'Amr');
  await pl.updateLead('e:bo@b.com', { note: 'Called, no answer', next: { text: 'Call again', due: '2026-11-12' } }, 'Amr');
  await pl.updateLead('e:bo@b.com', { next: { text: 'Call again', due: '2026-11-12' } }, 'Amr');
  let trail = JSON.parse(H.get('pl:trail').get('e:bo@b.com'));
  assert.deepEqual(trail.map(x => x.kind), ['next', 'note', 'note'], 'saving the same next step again adds nothing');
  assert.equal(trail[0].by, 'Amr'); assert.ok(trail[0].at > 0);
  await pl.updateLead('e:bo@b.com', { deal: 'dead', reason: 'no_reply', from: 'shown' }, 'Abdullah');
  const ovs = () => ({ leadOv: { 'e:bo@b.com': JSON.parse(H.get('pl:leadov').get('e:bo@b.com')) }, trails: { 'e:bo@b.com': JSON.parse(H.get('pl:trail').get('e:bo@b.com')) } });
  r = pl.build(Object.assign(JSON.parse(JSON.stringify(base)), ovs()));
  const bo = g(r, 'bo@b.com');
  assert.equal(bo.status, 'dead'); assert.equal(bo.deadReason, 'no_reply'); assert.equal(bo.attempts, 2); assert.equal(bo.nextStep.text, 'Call again'); assert.equal(bo.trail.slice(-1)[0].reason, 'no_reply');
  // a dead lead who books again comes back by itself
  const again = Object.assign(JSON.parse(JSON.stringify(base)), ovs());
  again.meetings.push(mt('M7', now + 3 * day, { name: 'Bo Kim', email: 'bo@b.com' }, null, now + 60e3));
  assert.equal(g(pl.build(again), 'bo@b.com').status, 'shown');
  // old stage names still read correctly
  assert.equal(g(pl.build(Object.assign(JSON.parse(JSON.stringify(base)), { leadOv: { 'e:ann@a.com': { deal: 'proposal' } } })), 'ann@a.com').status, 'shown');
  assert.equal(g(pl.build(Object.assign(JSON.parse(JSON.stringify(base)), { leadOv: { 'e:ann@a.com': { deal: 'lost', dealAt: now } } })), 'ann@a.com').status, 'dead');
  await assert.rejects(pl.updateLead('e:bo@b.com', { deal: 'maybe' }), /Unknown/);
  await assert.rejects(pl.updateLead('e:bo@b.com', { next: { text: 'x', due: 'soon' } }), /date/);
  const noteId = trail[1].id;
  await pl.deleteNote('e:bo@b.com', noteId);
  assert.ok(!JSON.parse(H.get('pl:trail').get('e:bo@b.com')).some(x => x.id === noteId));
  await assert.rejects(pl.deleteNote('e:bo@b.com', trail[0].id), /Unknown/, 'only notes can be deleted');
});

test('leads added by hand go to Shown; hot tags and an imported trail keep their dates', async () => {
  const r0 = await pl.addManualLead({ name: 'David Ross', company: 'Leonardo Worldwide', country: 'Canada', phone: '(416) 555-0100', type: 'outbound', note: 'Reviewing the contract' }, 'Amr');
  assert.equal(r0.key, 'n:david ross|leonardo worldwide');
  await pl.updateLead(r0.key, { hot: 'must_close' }, 'Amr');
  const when = Date.parse('2026-09-26T12:00:00Z');
  const imp = await pl.importNotes(r0.key, [{ at: when, text: 'Had meeting, interested' }, { at: when, text: 'Had meeting, interested' }, { at: 'bad', text: 'x' }], 'Ranked Leads sheet');
  assert.equal(imp.added, 1, 'duplicates and bad dates are skipped');
  const manual = {}; H.get('pl:manual').forEach((v, k) => { manual[k] = JSON.parse(v); });
  const base = { entries: [], sheets: [], recordings: [], outcomes: {}, skipEvents: null, meetings: [], manual: Object.values(manual),
    leadOv: { [r0.key]: JSON.parse(H.get('pl:leadov').get(r0.key)) }, trails: { [r0.key]: JSON.parse(H.get('pl:trail').get(r0.key)) } };
  const l = pl.build(base).leads.find(x => x.key === r0.key);
  assert.equal(l.status, 'shown'); assert.equal(l.hot, 'must_close'); assert.equal(l.origin, 'Added by hand'); assert.equal(l.type, 'outbound'); assert.equal(l.country, 'Canada');
  assert.equal(l.trail[0].at, when, 'the imported line keeps its own date and sorts first');
  assert.deepEqual(l.trail.map(x => x.kind), ['note', 'note', 'hot']);
  await assert.rejects(pl.addManualLead({ name: '' }), /name/);
});

test('a start date leaves out older meetings and leads', async () => {
  const day = 864e5, start = Date.parse('2026-09-01T00:00:00Z');
  const mt = (id, at, inv) => ({ id, name: 'Discovery Call', start: iso(at), end: iso(at + 1800e3), status: 'active', created: iso(at - day), invitees: [Object.assign({ qa: [], utm: {}, created: iso(at - day) }, inv)], override: { outcome: 'showed' } });
  const data = () => ({ since: '2026-09-01', entries: [{ id: 'w', form: 'Contact', at: iso(start - 5 * day), fields: { name: 'Old Web', email: 'old@web.com' } }], sheets: [], recordings: [], outcomes: {}, skipEvents: null, leadOv: {}, trails: {},
    meetings: [mt('O1', start - 20 * day, { name: 'Old Lead', email: 'old@x.com' }), mt('N1', start + 3 * day, { name: 'New Lead', email: 'new@x.com' }), mt('B1', start - 30 * day, { name: 'Both', email: 'both@x.com' }), mt('B2', start + 10 * day, { name: 'Both', email: 'both@x.com' })] });
  const d0 = data();
  d0.meetings.push(Object.assign(mt('T1', start - 40 * day, { name: 'Noted Lead', email: 'noted@x.com' }), { override: null }), Object.assign(mt('B0', start - 50 * day, { name: 'Both', email: 'both@x.com' }), { override: null }));
  d0.trails = { 'e:noted@x.com': [{ id: 'n', at: start + 5 * day, kind: 'note', text: 'Still talking', by: 'Amr' }] };
  const r = pl.build(d0);
  assert.deepEqual(r.leads.map(l => l.email).sort(), ['both@x.com', 'new@x.com', 'noted@x.com'], 'old leads go, unless something happened after the start date');
  assert.deepEqual(r.meetings.map(m => m.id).sort(), ['B1', 'B2', 'N1'], 'a kept lead keeps its older marked meetings; old unmarked ones are dropped');
  assert.equal(pl.build(Object.assign(data(), { since: '' })).meetings.length, 4);
  assert.equal(await pl.setSince('2026-09-01'), '2026-09-01');
  await assert.rejects(pl.setSince('soon'), /date/);
  await pl.setSince('');
});

test('someone who books several times is one lead, even with a new email or a typo in the name', async () => {
  const day = 864e5, t0 = Date.now() - 10 * day;
  const mt = (id, at, inv) => ({ id, name: 'Discovery Call', start: iso(at), end: iso(at + 1800e3), status: 'active', created: iso(at - day), invitees: [Object.assign({ qa: [], utm: {}, created: iso(at - day) }, inv)], override: { outcome: 'showed' } });
  const data = () => ({ since: '', entries: [], sheets: [], recordings: [], outcomes: {}, skipEvents: null, trails: {}, leadOv: {},
    meetings: [
      mt('R1', t0, { name: 'Raji Nwasir', email: 'raji@acme.com', phone: '+1 (416) 555-0199' }),
      mt('R2', t0 + 3 * day, { name: 'raji nwaser', email: 'rn@gmail.com', phone: '4165550199' }),
      mt('A1', t0, { name: 'Amr Abdelrazzak', email: 'amr@bpohive.com', phone: '+20 11 26656543' }),
      mt('A2', t0 + day, { name: 'Anr', email: 'amr_x@yahoo.com', phone: '+20 1126656543' }),
      mt('A3', t0 + day, { name: 'Test Ignore', email: 'someone@example.com' }),
      mt('C1', t0, { name: 'Omar Khan', email: 'omar@corp.com' }),
      mt('C2', t0 + day, { name: 'Omar', email: 'o.khan@corp.com' }),
      mt('P1', t0, { name: 'Priya Novak', email: 'priya.n@falcon.com' }),
      mt('P2', t0, { name: 'Priya Moreau', email: 'priya.m@falcon.com' }),
      mt('G1', t0, { name: 'Sara', email: 'sara@gmail.com' }),
      mt('G2', t0, { name: 'Sara', email: 'sara.k@gmail.com' })
    ] });
  const d = data();
  d.leadOv = { 'e:rn@gmail.com': { deal: 'shown', hot: 'contract', dealAt: 5 } };
  d.trails = { 'e:raji@acme.com': [{ id: 'a', at: 2, kind: 'note', text: 'first' }], 'e:rn@gmail.com': [{ id: 'b', at: 1, kind: 'note', text: 'older' }] };
  const r = pl.build(d);
  const raji = r.leads.filter(l => /raji/i.test(l.name));
  assert.equal(raji.length, 1, 'same phone = same lead');
  assert.equal(raji[0].meetings.length, 2);
  assert.deepEqual(raji[0].aliases, ['e:rn@gmail.com']);
  assert.equal(raji[0].hot, 'contract', 'what was saved under the other booking is kept');
  assert.deepEqual(raji[0].trail.map(x => x.text), ['older', 'first']);
  assert.equal(r.meetings.filter(m => m.seq === 2).length, 2, 'the second booking is a follow-up');
  assert.equal(r.leads.filter(l => /amr/i.test(l.name)).length, 0, 'bookings made with our own email addresses are tests and left out');
  assert.equal(r.meetings.filter(m => /^A/.test(m.id)).length, 0);
  assert.equal(r.leads.filter(l => /omar/i.test(l.name)).length, 1, 'same company domain and first name = same lead');
  assert.equal(r.leads.filter(l => /test/i.test(l.name)).length, 0);
  assert.equal(r.leads.filter(l => /sara/i.test(l.name)).length, 2, 'gmail addresses are not joined by first name');
  assert.equal(r.leads.filter(l => /priya/i.test(l.name)).length, 2, 'two people at one company with the same first name stay apart');
  // The first edit moves the other booking's notes onto the main lead
  H.set('pl:trail', new Map(Object.entries(d.trails).map(([k, v]) => [k, JSON.stringify(v)]))); H.set('pl:leadov', new Map(Object.entries(d.leadOv).map(([k, v]) => [k, JSON.stringify(v)])));
  await pl.updateLead(raji[0].key, { note: 'joined' }, 'Amr', raji[0].aliases);
  const tr = JSON.parse(H.get('pl:trail').get('e:raji@acme.com'));
  assert.deepEqual(tr.map(x => x.text), ['older', 'first', 'joined']);
  assert.equal(JSON.parse(H.get('pl:leadov').get('e:raji@acme.com')).hot, 'contract');
  assert.equal(H.get('pl:trail').has('e:rn@gmail.com'), false);
});

test('a deleted lead is left out until it books again, and can be brought back', async () => {
  const day = 864e5, t0 = Date.now() - 10 * day;
  const mt = (id, at, inv) => ({ id, name: 'Discovery Call', start: iso(at), end: iso(at + 1800e3), status: 'active', created: iso(at - day), invitees: [Object.assign({ qa: [], utm: {}, created: iso(at - day) }, inv)], override: { outcome: 'showed' } });
  const base = () => ({ since: '', entries: [], sheets: [], recordings: [], outcomes: {}, skipEvents: null, trails: {}, leadOv: {}, manual: [{ id: 'x', name: 'David Awad', type: 'outbound', at: iso(t0) }],
    meetings: [mt('D1', t0, { name: 'Dana Fox', email: 'dana@fox.com' })] });
  assert.equal(pl.build(base()).leads.length, 2);
  const r = pl.build(Object.assign(base(), { hidden: { 'n:david awad|': { at: Date.now(), name: 'David Awad' }, 'e:dana@fox.com': { at: Date.now() } } }));
  assert.equal(r.leads.length, 0);
  assert.equal(r.meetings.length, 0);
  assert.deepEqual(r.deleted.map(d => d.name).sort(), ['Dana Fox', 'David Awad']);
  const again = base(); again.meetings.push(mt('D2', Date.now() + 2 * day, { name: 'Dana Fox', email: 'dana@fox.com' })); again.meetings[1].created = iso(Date.now() + 1000);
  assert.equal(pl.build(Object.assign(again, { hidden: { 'e:dana@fox.com': { at: Date.now() } } })).leads.length, 2, 'booking again brings them back');
  await pl.deleteLead('n:david awad|', { name: 'David Awad' }, 'Amr');
  assert.ok(H.get('pl:hidden').has('n:david awad|'));
  await pl.restoreLead('n:david awad|');
  assert.equal(H.get('pl:hidden').has('n:david awad|'), false);
});
