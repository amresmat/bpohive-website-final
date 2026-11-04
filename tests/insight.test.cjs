const test = require('node:test');
const assert = require('node:assert');
const ins = require('../lib/insight.cjs');

// A tiny in-memory Redis that understands the commands lib/insight.cjs uses.
function fakeRedis() {
  const H = new Map(), L = new Map(), Z = new Map(), S = new Map();
  const num = v => Number(v) || 0;
  const run = (c) => {
    const [cmd, k, ...a] = c;
    switch (cmd) {
      case 'HSETNX': { const h = H.get(k) || new Map(); H.set(k, h); if (h.has(a[0])) return 0; h.set(a[0], String(a[1])); return 1; }
      case 'HSET': { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], String(a[1])); return 1; }
      case 'HINCRBY': { const h = H.get(k) || new Map(); H.set(k, h); const v = num(h.get(a[0])) + num(a[1]); h.set(a[0], String(v)); return v; }
      case 'HGET': { const h = H.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
      case 'HMGET': { const h = H.get(k); return a.map(f => (h && h.has(f) ? h.get(f) : null)); }
      case 'HGETALL': { const h = H.get(k); return h ? [...h.entries()].flat() : []; }
      case 'RPUSH': { const l = L.get(k) || []; L.set(k, l); l.push(...a); return l.length; }
      case 'LTRIM': { const l = L.get(k) || []; const s = num(a[0]), e = num(a[1]); const sl = l.slice(s < 0 ? Math.max(0, l.length + s) : s, e < 0 ? l.length + e + 1 : e + 1); L.set(k, sl); return 'OK'; }
      case 'LRANGE': { const l = L.get(k) || []; const s = num(a[0]), e = num(a[1]); return l.slice(s, e < 0 ? l.length + e + 1 : e + 1); }
      case 'LLEN': return (L.get(k) || []).length;
      case 'ZADD': { const z = Z.get(k) || new Map(); Z.set(k, z); const nx = a[0] === 'NX'; const [score, member] = nx ? a.slice(1) : a; if (nx && z.has(member)) return 0; z.set(member, num(score)); return 1; }
      case 'ZREM': { const z = Z.get(k); if (!z) return 0; return a.reduce((n, m) => n + (z.delete(m) ? 1 : 0), 0); }
      case 'ZCARD': return (Z.get(k) || new Map()).size;
      case 'ZREVRANGE': { const z = [...(Z.get(k) || new Map()).entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]); return z.slice(num(a[0]), num(a[1]) + 1); }
      case 'ZRANGE': { const z = [...(Z.get(k) || new Map()).entries()].sort((x, y) => x[1] - y[1]).map(x => x[0]); return z.slice(num(a[0]), num(a[1]) + 1); }
      case 'ZRANGEBYSCORE': { const lo = a[0] === '-inf' ? -Infinity : num(a[0]), hi = a[1] === '+inf' ? Infinity : num(a[1]); return [...(Z.get(k) || new Map()).entries()].filter(x => x[1] >= lo && x[1] <= hi).sort((x, y) => x[1] - y[1]).map(x => x[0]); }
      case 'ZREVRANGEBYSCORE': { const hi = a[0] === '+inf' ? Infinity : num(a[0]), lo = a[1] === '-inf' ? -Infinity : num(a[1]); const off = a[2] === 'LIMIT' ? num(a[3]) : 0, cnt = a[2] === 'LIMIT' ? num(a[4]) : 1e9; return [...(Z.get(k) || new Map()).entries()].filter(x => x[1] >= lo && x[1] <= hi).sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(off, off + cnt); }
      case 'INCRBY': { const v = num(S.get(k)) + num(a[0]); S.set(k, String(v)); return v; }
      case 'DECRBY': { const v = num(S.get(k)) - num(a[0]); S.set(k, String(v)); return v; }
      case 'GET': return S.has(k) ? S.get(k) : null;
      case 'DEL': { let n = 0; for (const key of [k, ...a]) { n += (H.delete(key) ? 1 : 0) + (L.delete(key) ? 1 : 0); } return n; }
      case 'EXPIRE': return 1;
      default: throw new Error('fake redis: unsupported ' + cmd);
    }
  };
  return { pipe: async cmds => cmds.map(run), H, L, Z, S };
}

const ev = (type, data, timestamp) => ({ type, data, timestamp });
const custom = (tag, payload, t) => ev(5, { tag, payload }, t);
const sid = 'a1b2c3d4e5f60718', vid = '0123456789abcdef';
const req = { headers: { 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'Dallas' } };

test('a batch creates a session, pages, daily stats and a replay chunk', async () => {
  const r = fakeRedis(); ins._setPipe(r.pipe);
  const t = Date.now();
  await ins.ingest({ sid, vid, seq: 1, events: [
    custom('pageview', { path: '/', title: 'Home', ref: 'https://www.google.com/', ua: 'Mozilla/5.0 (iPhone) Safari/605', w: 390, h: 844, newSession: true, utm: {} }, t),
    ev(4, { href: 'https://www.bpohive.com/', width: 390, height: 844 }, t + 1),
    ev(2, { node: { type: 0, childNodes: [] } }, t + 2),
    custom('popup_open', { path: '/' }, t + 5000),
    custom('field', { form: 'Fill my calendar pop-up', name: 'name', k: 'focus' }, t + 6000),
    custom('field', { form: 'Fill my calendar pop-up', name: 'name', k: 'filled', filled: true }, t + 7000),
    custom('field', { form: 'Fill my calendar pop-up', name: 'email', k: 'focus' }, t + 8000)
  ] }, req);
  const { rows, total } = await ins.listSessions();
  assert.equal(total, 1);
  const s = rows[0];
  assert.equal(s.id, sid); assert.equal(s.country, 'US'); assert.equal(s.city, 'Dallas'); assert.equal(s.device, 'mobile'); assert.equal(s.browser, 'Safari');
  assert.equal(s.source, 'google'); assert.equal(s.entry, '/'); assert.equal(s.pages, 1); assert.equal(s.popup, true); assert.equal(s.submit, false);
  assert.equal(s.lastField, 'Fill my calendar pop-up|email');
  const full = await ins.getSession(sid);
  assert.equal(full.chunks, 1); assert.equal(full.pageList[0].path, '/');
  const events = await ins.getEvents(sid);
  assert.equal(events.length, 7); assert.equal(events[0].type, 5);
  const o = await ins.overview(7);
  assert.equal(o.totals.pv, 1); assert.equal(o.totals.s, 1); assert.equal(o.totals.open, 1);
  assert.deepEqual(o.sources[0], { name: 'google', n: 1 }); assert.deepEqual(o.countries[0], { name: 'US', n: 1 }); assert.deepEqual(o.devices[0], { name: 'mobile', n: 1 });
  assert.ok(o.storage.bytes > 0);
  const f = await ins.forms(7);
  const popup = f.forms.find(x => x.form === 'Fill my calendar pop-up');
  assert.ok(popup); assert.equal(popup.abandoned, 1);
  const email = popup.fields.find(x => x.name === 'email'); assert.equal(email.abandon, 1);
  const name = popup.fields.find(x => x.name === 'name'); assert.equal(name.filled, 1);
});

test('later batches extend the same session and submit clears the abandon count', async () => {
  const r = fakeRedis(); ins._setPipe(r.pipe);
  const t = Date.now();
  await ins.ingest({ sid, vid, seq: 1, events: [custom('pageview', { path: '/pricing', title: 'Pricing', ref: '', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', w: 1440, h: 900, newSession: true, utm: { utm_source: 'linkedin' } }, t), custom('field', { form: 'Fill my calendar pop-up', name: 'name', k: 'focus' }, t + 1)] }, req);
  await ins.ingest({ sid, vid, seq: 2, events: [custom('pageview', { path: '/about', title: 'About', ref: 'https://www.bpohive.com/pricing', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', w: 1440, h: 900, newSession: false, utm: {} }, t + 20000), custom('popup_open', {}, t + 21000), custom('popup_submit', {}, t + 30000), custom('booked', {}, t + 60000)] }, req);
  const s = (await ins.listSessions()).rows[0];
  assert.equal(s.pages, 2); assert.equal(s.source, 'linkedin'); assert.equal(s.booked, true); assert.equal(s.duration, 60); assert.equal(s.device, 'desktop'); assert.equal(s.browser, 'Chrome');
  const o = await ins.overview(7); assert.equal(o.totals.pv, 2); assert.equal(o.totals.s, 1); assert.equal(o.totals.booked, 1);
  const f = await ins.forms(7); assert.equal(f.forms[0].abandoned, 0);
  const events = await ins.getEvents(sid); assert.equal(events.length, 6); assert.ok(events[0].timestamp <= events[5].timestamp);
  assert.equal(await ins.deleteSession(sid), true);
  assert.equal((await ins.listSessions()).total, 0);
  assert.equal(Number(r.S.get('ins:bytes')), 0);
});

test('bad batches are rejected', async () => {
  ins._setPipe(fakeRedis().pipe);
  await assert.rejects(() => ins.ingest({ sid: 'nope', vid, events: [custom('pageview', {}, 1)] }, req));
  await assert.rejects(() => ins.ingest({ sid, vid, events: [] }, req));
  await assert.rejects(() => ins.ingest({ sid, vid, events: [{ bad: true }] }, req));
});

test('device and source detection', () => {
  assert.equal(ins.device('Mozilla/5.0 (iPad; CPU OS 17_0) Safari/605').device, 'tablet');
  assert.equal(ins.device('Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile').os, 'Android');
  assert.equal(ins.source('https://www.linkedin.com/feed', {}), 'linkedin');
  assert.equal(ins.source('', { gclid: 'x' }), 'google ads');
  assert.equal(ins.source('https://news.ycombinator.com/', {}), 'news.ycombinator.com');
  assert.equal(ins.source('', {}), 'direct');
});

test('AI assistants and search engines are recognised as sources', () => {
  assert.equal(ins.source('https://chatgpt.com/c/abc', {}), 'chatgpt');
  assert.equal(ins.source('https://claude.ai/chat/x', {}), 'claude');
  assert.equal(ins.source('https://www.perplexity.ai/search/y', {}), 'perplexity');
  assert.equal(ins.source('https://copilot.microsoft.com/', {}), 'copilot');
  assert.equal(ins.source('', { utm_source: 'chatgpt.com' }), 'chatgpt');
  assert.equal(ins.source('https://www.google.com/', {}), 'google');
  assert.equal(ins.isAI('chatgpt'), true); assert.equal(ins.isAI('google'), false);
});

test('excluded countries are not stored', async () => {
  process.env.VERCEL_ENV = 'development';
  const r = fakeRedis(); ins._setPipe(r.pipe);
  const handler = require('../api/insight/collect.js');
  const mk = (country) => ({ method: 'POST', headers: { 'x-vercel-ip-country': country, 'content-type': 'application/json' }, body: { sid, vid, seq: 1, events: [custom('pageview', { path: '/', newSession: true, ua: 'x' }, Date.now())] }, socket: {} });
  const res = () => { const o = { code: 0, headers: {}, status(c) { o.code = c; return o; }, setHeader(k, v) { o.headers[k] = v; }, end() { return o; }, json() { return o; } }; return o; };
  const a = res(); await handler(mk('EG'), a); assert.equal(a.code, 204); assert.equal(a.headers['X-Insight'], 'skip');
  assert.equal((await ins.listSessions()).total, 0);
  const b = res(); await handler(mk('US'), b); assert.equal(b.code, 204); assert.equal(b.headers['X-Insight'], undefined);
  assert.equal((await ins.listSessions()).total, 1);
});
