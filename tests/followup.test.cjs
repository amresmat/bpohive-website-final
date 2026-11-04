const test = require('node:test');
const assert = require('node:assert');
process.env.KV_REST_API_URL = 'http://fake'; process.env.KV_REST_API_TOKEN = 'x'; process.env.ADMIN_PASSWORD = 'pw';
// In-memory Redis behind fetch for lib/entries.cjs
const S = new Map(), Z = new Map(), SETS = new Map(), H = new Map(), L = new Map();
const num = v => Number(v) || 0;
function cmd(c) { const [op, k, ...a] = c; switch (op) {
  case 'GET': return S.has(k) ? S.get(k) : null;
  case 'SET': { if (a.includes('NX') && S.has(k)) return null; S.set(k, a[0]); return 'OK'; }
  case 'MGET': return [k, ...a].map(x => S.has(x) ? S.get(x) : null);
  case 'ZADD': { const z = Z.get(k) || new Map(); Z.set(k, z); z.set(a[1], num(a[0])); return 1; }
  case 'ZRANGEBYSCORE': { const lo = num(a[0]), hi = num(a[1]); return [...(Z.get(k) || new Map())].filter(x => x[1] >= lo && x[1] <= hi).map(x => x[0]); }
  case 'SMEMBERS': return [...(SETS.get(k) || [])];
  case 'SADD': { const s = SETS.get(k) || new Set(); SETS.set(k, s); a.forEach(x => s.add(x)); return 1; }
  case 'SCARD': return (SETS.get(k) || new Set()).size;
  case 'HGETALL': { const h = H.get(k); return h ? [...h].flat() : []; }
  case 'HSET': { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], a[1]); return 1; }
  case 'EXPIRE': return 1;
  case 'LPUSH': { const l = L.get(k) || []; L.set(k, l); l.unshift(...a); return l.length; }
  case 'LTRIM': return 'OK';
  case 'LRANGE': { const l = L.get(k) || []; const e = num(a[1]); return l.slice(num(a[0]), e < 0 ? l.length : e + 1); }
  default: throw new Error('unsupported ' + op); } }
const sentMail = [];
global.fetch = async (url, opt) => {
  if (String(url).includes('brevo')) { sentMail.push(JSON.parse(opt.body)); return { ok: true, text: async () => '' }; }
  const cmds = JSON.parse(opt.body); return { ok: true, json: async () => cmds.map(c => ({ result: cmd(c) })) };
};
const fu = require('../lib/followup.cjs');
const draft = (id, fields, ago, extra = {}) => { const t = Date.now() - ago; S.set('draft:' + id, JSON.stringify(Object.assign({ id, form: 'Fill my calendar pop-up', page: 'https://www.bpohive.com/', first: t, updated: t, fields }, extra))); const z = Z.get('drafts') || new Map(); Z.set('drafts', z); z.set(id, t); };

test('preview mode sends nothing, live mode sends one email per person, then a reminder', async () => {
  draft('aaaaaaaaaaaa01', { name: 'jane cooper', email: 'Jane@Northwind.io', company: 'Northwind' }, 2 * 3600e3);
  draft('aaaaaaaaaaaa02', { name: 'Too Soon', email: 'soon@acme.io' }, 10 * 60e3);
  draft('aaaaaaaaaaaa03', { name: 'Team', email: 'amr@bpohive.com' }, 2 * 3600e3);
  draft('aaaaaaaaaaaa04', { name: 'Can', email: 'can@maple.ca', phoneCountry: 'CA' }, 2 * 3600e3);
  draft('aaaaaaaaaaaa05', { name: 'Can Yes', email: 'yes@maple.ca', phoneCountry: 'CA', marketingConsent: 'Yes' }, 2 * 3600e3);
  draft('aaaaaaaaaaaa06', { name: 'Recruit', email: 'agent@realty.com' }, 2 * 3600e3, { page: 'https://www.bpohive.com/real-estate-recruiting' });
  let r = await fu.run({ force: true });
  assert.equal(r.live, false); assert.equal(sentMail.length, 0);
  assert.deepEqual(r.results.map(x => x.email).sort(), ['jane@northwind.io', 'yes@maple.ca']);
  assert.ok(r.skipped.find(x => x.email === 'can@maple.ca'));
  process.env.BREVO_API_KEY = 'k'; process.env.FOLLOWUP_ENABLED = '1';
  r = await fu.run({ force: true });
  assert.equal(sentMail.length, 2);
  const m = sentMail.find(x => x.to[0].email === 'jane@northwind.io');
  assert.equal(m.sender.email, 'success@bpohive.com'); assert.equal(m.subject, 'Jane, your calendar almost got busier 📅');
  assert.match(m.htmlContent, /Northwind/); assert.match(m.htmlContent, /Unsubscribe/); assert.match(m.headers['List-Unsubscribe'], /unsubscribe\?t=/);
  r = await fu.run({ force: true }); assert.equal(sentMail.length, 2, 'no repeat within 3 days');
  // three days later -> reminder
  H.get('followup:jane@northwind.io').set('first', String(Date.now() - 3 * 86400e3 - 1000));
  r = await fu.run({ force: true }); assert.equal(sentMail.length, 3); assert.match(sentMail[2].subject, /^Re: /);
  H.get('followup:jane@northwind.io').set('second', String(Date.now() - 10 * 86400e3));
  r = await fu.run({ force: true }); assert.equal(sentMail.length, 3, 'never a third email');
});

test('sending a form or unsubscribing stops the emails; resume link restores answers', async () => {
  draft('bbbbbbbbbbbb01', { name: 'Sam', email: 'sam@globex.com', company: 'Globex', plan: 'growth' }, 2 * 3600e3);
  L.set('entries', [JSON.stringify({ id: 'e1', form: 'Build my campaign', fields: { email: 'sam@globex.com' } })]);
  const before = sentMail.length; await fu.run({ force: true });
  assert.equal(sentMail.filter(x => x.to[0].email === 'sam@globex.com').length, 0);
  draft('bbbbbbbbbbbb02', { name: 'Ann', email: 'ann@initech.com' }, 2 * 3600e3);
  const email = await fu.unsubscribe(fu.token('ann@initech.com')); assert.equal(email, 'ann@initech.com');
  await fu.run({ force: true }); assert.equal(sentMail.filter(x => x.to[0].email === 'ann@initech.com').length, 0);
  assert.equal(await fu.unsubscribe('bad.token'), '');
  const f = await fu.resume(fu.token('bbbbbbbbbbbb01')); assert.equal(f.company, 'Globex'); assert.equal(f.plan, 'growth');
  assert.equal(await fu.resume('x.y'), null);
  assert.ok(sentMail.length >= before);
});
