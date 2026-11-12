const test = require('node:test');
const assert = require('node:assert');
const intel = require('../lib/intel.cjs');

function fakeRedis() {
  const H = new Map(), S = new Map();
  const run = ([cmd, k, ...a]) => {
    if (cmd === 'HSET') { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], String(a[1])); return 1; }
    if (cmd === 'HGETALL') { const h = H.get(k); return h ? [...h.entries()].flat() : []; }
    if (cmd === 'GET') return S.has(k) ? S.get(k) : null;
    if (cmd === 'SET') { S.set(k, String(a[0])); return 'OK'; }
    throw new Error('unsupported ' + cmd);
  };
  return { pipe: async cmds => cmds.map(run), H, S };
}
const req = { headers: { 'x-vercel-oidc-token': 'oidc-test' } };
const json = (o, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(o), json: async () => o, headers: { get: () => 'application/json' } });

function fakeFetch(log, opts = {}) {
  return async (url, o = {}) => {
    log.push({ url, body: o.body ? JSON.parse(o.body) : null, auth: (o.headers || {}).Authorization, model: (o.headers || {})['ai-model-id'] });
    if (opts.fail) return json({ error: { message: 'No credits' } }, 402);
    if (/media\.vocaroo\.com/.test(url)) return { ok: true, status: 200, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new Uint8Array(5000).buffer };
    if (/transcription-model/.test(url)) return json({ text: 'Hi this is Shane from BPO Hive. We run outbound for ERP vendors. They have two SDRs and want more meetings in Saudi. Budget around four thousand a month.' });
    const body = JSON.parse(o.body);
    if (body.model === 'perplexity/sonar') return json({ choices: [{ message: { content: 'Here: {"found":true,"name":"Milestone Systems","website":"https://milestone.us","what":"Builds video management software for security teams.","industry":"Security software","hq":"Wichita, US","employees":"51-200","revenue":"$10M-$50M (est.)","founded":"1998","linkedin":"https://www.linkedin.com/company/milestone","notes":"Opened a Dallas office in 2026."}' } }], citations: ['https://milestone.us/about'] });
    return json({ choices: [{ message: { content: '- Sells ERP to mid-market in KSA\n- Two SDRs today, wants more meetings\n- Budget about $4,000 a month' } }] });
  };
}

const lead = { key: 'e:tpa@milestone.us', aliases: [], name: 'Tim Palmquist', email: 'tpa@milestone.us', company: 'milestone', status: 'booked', sheetRows: [{ recording: 'https://voca.ro/17s3tEEeziBK' }, { recording: 'https://web.salesfinity.co/call-detail/abc' }] };

test('a lead gets a company profile and a booking-call summary, once', async () => {
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe); intel._setFetch(fakeFetch(log));
  const out = await intel.runBatch([lead], req, { budgetMs: 20000 });
  const it = out.done[lead.key];
  assert.equal(it.company.found, true); assert.equal(it.company.name, 'Milestone Systems'); assert.equal(it.company.revenue, '$10M-$50M (est.)'); assert.deepEqual(it.company.sources, ['https://milestone.us/about']);
  const c = it.calls['https://voca.ro/17s3tEEeziBK'];
  assert.match(c.summary, /ERP/);
  assert.equal(it.calls['https://web.salesfinity.co/call-detail/abc'], undefined, 'Salesfinity is skipped');
  assert.ok(log.every(x => !/ai-gateway/.test(x.url) || x.auth === 'Bearer oidc-test'), 'uses the OIDC token');
  assert.equal(log.find(x => /transcription-model/.test(x.url)).model, 'openai/gpt-4o-mini-transcribe');
  assert.equal(out.remaining, 0);
  // Nothing left to do on the next run.
  const n = log.length; const again = await intel.runBatch([lead], req, {}); assert.equal(log.length, n); assert.equal(again.remaining, 0);
  assert.equal((await intel.getAll())[lead.key].company.hq, 'Wichita, US');
});

test('no credit or no access pauses the work instead of failing every lead', async () => {
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe); intel._setFetch(fakeFetch(log, { fail: true }));
  const out = await intel.runBatch([lead], req, {});
  assert.equal(out.paused, true); assert.match(out.error, /credits/);
  const n = log.length; const again = await intel.runBatch([lead], req, {}); assert.equal(again.paused, true); assert.equal(log.length, n, 'no calls while paused');
});

test('without a token nothing runs; leads with a free email and no company are skipped', async () => {
  const r = fakeRedis(); intel._setPipe(r.pipe);
  assert.equal((await intel.runBatch([lead], { headers: {} }, {})).skipped, process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY ? undefined : true);
  assert.deepEqual(intel.todo({ key: 'e:a@gmail.com', email: 'a@gmail.com', company: '', sheetRows: [] }, null), []);
  assert.equal(intel.audioOf('https://voca.ro/18OeTudAGd5P'), 'https://media.vocaroo.com/mp3/18OeTudAGd5P');
  assert.equal(intel.canSummarize('https://web.salesfinity.co/call-detail/x'), false);
});

test('Retry now (force) runs even while paused', async () => {
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe);
  intel._setFetch(fakeFetch(log, { fail: true })); await intel.runBatch([lead], req, {});
  intel._setFetch(fakeFetch(log));
  assert.equal((await intel.runBatch([lead], req, {})).paused, true);
  const out = await intel.runBatch([lead], req, { force: true });
  assert.equal(out.paused, undefined); assert.equal(out.done[lead.key].company.found, true);
  assert.equal((await intel.runBatch([lead], req, {})).paused, undefined, 'the pause is cleared after a good run');
});

test('an empty AI summary is not kept, and is redone on the next run', async () => {
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe);
  const base = fakeFetch(log);
  intel._setFetch(async (u, o) => { if (/chat\/completions/.test(u) && JSON.parse(o.body).model !== 'perplexity/sonar') return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '' } }] }) }; return base(u, o); });
  const out = await intel.runBatch([lead], req, {});
  const c = out.done[lead.key].calls['https://voca.ro/17s3tEEeziBK']; assert.match(c.error, /empty/);
  // A summary saved empty by an older version is redone too.
  r.H.get('pl:intel').set(lead.key, JSON.stringify({ company: out.done[lead.key].company, calls: { 'https://voca.ro/17s3tEEeziBK': { summary: '', at: 1 } } }));
  intel._setFetch(base);
  const again = await intel.runBatch([lead], req, {});
  assert.match(again.done[lead.key].calls['https://voca.ro/17s3tEEeziBK'].summary, /ERP/);
});

test('revenue is always shown: estimated from headcount when nothing is published, and old profiles are redone', async () => {
  assert.equal(intel.revenueFromSize('51-200'), '$13M-$31M (est. from size)');
  assert.equal(intel.revenueFromSize(''), '');
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe);
  const base = fakeFetch(log);
  intel._setFetch(async (u, o) => { if (/chat\/completions/.test(u) && JSON.parse(o.body).model === 'perplexity/sonar') return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"found":true,"name":"Mueen","employees":"201-500","revenue":""}' } }] }) }; return base(u, o); });
  r.H.set('pl:intel', new Map([[lead.key, JSON.stringify({ company: { found: true, name: 'Old', revenue: '', at: 1 }, calls: { 'https://voca.ro/17s3tEEeziBK': { summary: '- long old summary', at: 1 } } })]]));
  const out = await intel.runBatch([lead], req, {});
  assert.equal(out.done[lead.key].company.revenue, '$35M-$88M (est. from size)');
  assert.equal(out.done[lead.key].calls['https://voca.ro/17s3tEEeziBK'].v, 2, 'old long summaries are redone in the short style');
});

test('a redo that cannot find the company keeps the profile found before', async () => {
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe);
  const base = fakeFetch(log);
  intel._setFetch(async (u, o) => { if (/chat\/completions/.test(u) && JSON.parse(o.body).model === 'perplexity/sonar') return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"found":false}' } }] }) }; return base(u, o); });
  r.H.set('pl:intel', new Map([[lead.key, JSON.stringify({ company: { found: true, name: 'Milestone Systems', employees: '1,500+', revenue: '', at: 1 }, calls: {} })]]));
  const out = await intel.runBatch([lead], req, {});
  assert.equal(out.done[lead.key].company.name, 'Milestone Systems');
  assert.equal(out.done[lead.key].company.revenue, '$150M-$375M (est. from size)');
});

test('a Salesfinity Meeting Set call is summarized from its transcript', async () => {
  const sf = require('../lib/salesfinity.cjs');
  const r = fakeRedis(), log = []; intel._setPipe(r.pipe); intel._setFetch(fakeFetch(log));
  sf._setPipe(async cmds => cmds.map(([c, k, f]) => c === 'HGET' ? JSON.stringify({ id: 'sf1', transcript: 'Hi Tim this is Shayen from BPO Hive, we book meetings for ERP vendors and want to set a demo next week.' }) : null));
  const l = { key: 'e:tpa@milestone.us', name: 'Tim', email: 'tpa@gmail.com', company: '', sheetRows: [], sfCalls: [{ id: 'sf1', hasText: true }] };
  const out = await intel.runBatch([l], req, {});
  const c = out.done[l.key].calls['sf:sf1'];
  assert.match(c.summary, /ERP/); assert.equal(c.source, 'salesfinity');
  assert.equal(log.filter(x => /transcription-model/.test(x.url)).length, 0, 'no transcription needed');
});
