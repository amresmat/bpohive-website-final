const test = require('node:test');
const assert = require('node:assert');
process.env.SALESFINITY_API_KEY = 'sf-test';
const sf = require('../lib/salesfinity.cjs');

function fakeRedis() {
  const H = new Map(), S = new Map();
  const run = ([cmd, k, ...a]) => {
    if (cmd === 'HSET') { const h = H.get(k) || new Map(); H.set(k, h); for (let i = 0; i < a.length; i += 2) h.set(a[i], String(a[i + 1])); return 1; }
    if (cmd === 'HGETALL') { const h = H.get(k); return h ? [...h.entries()].flat() : []; }
    if (cmd === 'HGET') { const h = H.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
    if (cmd === 'GET') return S.has(k) ? S.get(k) : null;
    if (cmd === 'SET') { S.set(k, String(a[0])); return 'OK'; }
    throw new Error('unsupported ' + cmd);
  };
  return { pipe: async cmds => cmds.map(run), H, S };
}
const call = (id, email, extra = {}) => Object.assign({ _id: id, call_id: 'c' + id, outcome: 'answered', duration: 245, to: '+1 316 573 9933', started_at: '2026-11-11T16:40:00Z', createdAt: '2026-11-11T16:45:00Z',
  disposition: { internal_id: 1, external_name: 'Meeting Set' }, contact: { first_name: 'Tim', last_name: 'Palmquist', email, company: 'Milestone', phone_numbers: [{ number: '+13165739933' }] },
  user: { first_name: 'Shayen', last_name: 'B' }, recording_url: 'https://rec.salesfinity.co/' + id + '.mp3', transcription: 'Hi Tim, this is Shayen from BPO Hive...', summary: 'Booked a demo.' }, extra);

test('sync pulls Meeting Set calls with the API key and stores them', async () => {
  const r = fakeRedis(); sf._setPipe(r.pipe); const urls = [];
  sf._setFetch(async (u, o) => { urls.push({ u, key: o.headers['x-api-key'] }); return { ok: true, status: 200, json: async () => ({ data: [call('6a613', 'tpa@milestone.us')], pagination: { total: 1, page: 1, limit: 100, pages: 1 } }) }; });
  const out = await sf.sync({ force: true });
  assert.equal(out.saved, 1); assert.equal(urls[0].key, 'sf-test');
  assert.match(urls[0].u, /\/v1\/call-log\?limit=100&page=1&filters\[disposition_ids\]\[\]=1&filters\[start_date\]=/);
  const [c] = await sf.all();
  assert.equal(c.email, 'tpa@milestone.us'); assert.equal(c.rep, 'Shayen B'); assert.equal(c.link, 'https://web.salesfinity.co/call-detail/6a613'); assert.deepEqual(c.phones, ['165739933']);
  assert.equal((await sf.sync()).skipped, true, 'not again within 10 minutes');
});

test('only Calendly-booked leads without a form recording get the Salesfinity call', () => {
  const calls = [sf.slim(call('a1', 'tpa@milestone.us')), sf.slim(call('a2', 'x@other.com', { contact: { first_name: 'Jane', last_name: 'Roe', phone_numbers: [{ number: '+1 555 0100 222' }] } }))];
  const meetings = [{ id: 'm1', kind: 'calendly' }, { id: 'm2', kind: 'calendly' }, { id: 'm3', kind: 'calendly' }, { id: 's1', kind: 'sheet' }];
  const leads = [
    { key: 'e:tpa@milestone.us', email: 'tpa@milestone.us', name: 'Tim Palmquist', meetings: ['m1'], sheetRows: [] },
    { key: 'p:jane', email: '', phone: '(555) 0100-222', name: 'Jane Roe', meetings: ['m2'], sheetRows: [] },
    { key: 'e:has@form.com', email: 'tpa@milestone.us', name: 'Has Form', meetings: ['m3'], sheetRows: [{ recording: 'https://voca.ro/x' }] },
    { key: 'e:sheetonly', email: 'tpa@milestone.us', name: 'Sheet only', meetings: ['s1'], sheetRows: [] }
  ];
  sf.attach(leads, meetings, calls);
  assert.equal(leads[0].sfCalls[0].id, 'a1'); assert.equal(leads[0].sfCalls[0].hasText, true);
  assert.equal(leads[1].sfCalls[0].id, 'a2', 'matched by phone');
  assert.equal(leads[2].sfCalls, undefined, 'has a form recording');
  assert.equal(leads[3].sfCalls, undefined, 'not a Calendly booking');
});
