// Storage for the admin "Analytics" section (visitor sessions, replays, daily stats).
// Everything lives in the project's Upstash Redis database next to the form entries.
// Keys:
//   ins:s:<sid>   hash   session summary (who, where, device, pages, funnel flags, bytes)
//   ins:p:<sid>   list   pages visited [{path,title,t}]
//   ins:c:<sid>   list   recording chunks, gzip + base64 JSON event arrays, each prefixed "seq|"
//   ins:idx       zset   sid scored by session start time
//   ins:d:<day>   hash   daily counters (views, sessions, pages, referrers, countries, devices, funnel)
//   ins:f:<day>   hash   daily form-field counters (focus/filled per form field)
//   ins:bytes     int    bytes used by recordings, kept under BUDGET by pruning the oldest sessions
const zlib = require('node:zlib');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEEP_DAYS = Number(process.env.INSIGHT_KEEP_DAYS) || 90;
const KEEP_SEC = KEEP_DAYS * 86400;
const BUDGET = (Number(process.env.INSIGHT_BUDGET_MB) || 180) * 1024 * 1024;
const MAX_CHUNKS = 400;      // per session
const MAX_PAGES = 200;       // per session

let pipeImpl = null;         // tests can swap the transport
const configured = () => Boolean(pipeImpl || (URL_ && TOKEN));

async function pipe(commands) {
  if (!commands.length) return [];
  if (pipeImpl) return pipeImpl(commands);
  if (!configured()) return null;
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('Database returned ' + r.status);
  return (await r.json()).map(x => x.result);
}

const str = (v, n = 300) => (v == null ? '' : String(v).slice(0, n));
const dayOf = ts => new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isId = v => /^[a-f0-9]{16}$/.test(String(v || ''));

function device(ua) {
  ua = String(ua || '');
  const d = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop';
  const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Mac OS/i.test(ua) ? 'macOS' : /CrOS/i.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /SamsungBrowser/i.test(ua) ? 'Samsung' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Other';
  return { device: d, os, browser };
}

// Where a visit came from. AI assistants are recognised so they can be filtered on their own.
const AI = [[/chatgpt\.com|chat\.openai\.com|openai\.com/, 'chatgpt'], [/claude\.ai|anthropic\.com/, 'claude'], [/perplexity\.ai/, 'perplexity'], [/gemini\.google\.com|bard\.google\.com/, 'gemini'], [/copilot\.microsoft\.com|bing\.com\/chat/, 'copilot'], [/you\.com/, 'you.com'], [/poe\.com/, 'poe'], [/mistral\.ai|lechat/, 'mistral'], [/deepseek\.com/, 'deepseek'], [/grok\.com|x\.ai/, 'grok'], [/meta\.ai/, 'meta ai'], [/duckduckgo\.com\/\?.*ia=chat|duck\.ai/, 'duck.ai']];
const AI_NAMES = new Set(AI.map(x => x[1]));
function source(ref, utm) {
  const r = String(ref || '').toLowerCase();
  for (const [re, name] of AI) if (re.test(r)) return name;
  if (utm && utm.utm_source) {
    const u = str(utm.utm_source, 60).toLowerCase().replace(/\.com$|\.ai$/, '');
    for (const [re, name] of AI) if (re.test(u) || u === name || u === name.replace(/\s/g, '')) return name;
    return u;
  }
  if (utm && utm.gclid) return 'google ads';
  if (utm && utm.fbclid) return 'facebook';
  const h = hostOf(ref);
  if (!h) return 'direct';
  if (/google\./.test(h)) return 'google';
  if (/bing\.com/.test(h)) return 'bing';
  if (/duckduckgo\.com/.test(h)) return 'duckduckgo';
  if (/yahoo\./.test(h)) return 'yahoo';
  if (/linkedin\.com|lnkd\.in/.test(h)) return 'linkedin';
  if (/facebook\.com|fb\.com|instagram\.com/.test(h)) return 'facebook';
  if (/t\.co$|twitter\.com|x\.com/.test(h)) return 'x';
  if (/youtube\.com|youtu\.be/.test(h)) return 'youtube';
  if (/clutch\.co/.test(h)) return 'clutch';
  if (/bpohive\.com$/.test(h)) return 'direct';
  return h.slice(0, 60);
}
const isAI = name => AI_NAMES.has(String(name || ''));

// Company behind the visitor's internet address (looked up in the visitor's browser via ipapi.is).
// Home, mobile and cloud networks say nothing about who the visitor works for, so they are marked
// as "network" and kept out of the company list.
const NETWORK_RE = new RegExp([
  'tele(com|kom|communication|fonica|net|data)', '\\bte data\\b', 'communications?\\b', 'broadband', 'mobile', 'wireless', 'cellular', 'cable', 'internet', '\\bisp\\b', '\\bnet(works?)?\\b', 'online', 'fib(er|re)', 'hosting', 'host\\b', 'cloud', 'server', 'data ?cent(er|re)', 'datacenter', 'colo(cation)?\\b', 'vpn', 'proxy', 'relay',
  'vodafone', 'orange', 'etisalat', '\\be&\\b', '\\bdu\\b', 'emirates integrated', '\\bstc\\b', 'saudi telecom', 'zain', 'mobily', 'ooredoo', 'batelco', 'omantel', '\\bwe\\b', 'telecom egypt', 'link\\.net', 'link egypt', 'noor', 'raya', 'du telecom',
  'verizon', 'comcast', 'at&t', '\\batt\\b', 'charter', 'spectrum', 't-mobile', 'sprint', '\\bcox\\b', 'centurylink', 'lumen', 'frontier', 'windstream', 'altice', 'optimum', 'mediacom', 'cogent', 'level ?3', 'hughes', 'viasat', 'starlink', 'spacex',
  'rogers', 'bell canada', 'telus', '\\bshaw\\b', 'videotron', '\\bbt\\b', 'british telecom', '\\bsky\\b', 'virgin', 'talktalk', 'plusnet', 'deutsche telekom', 'movistar', '\\btim\\b', 'swisscom', 'proximus', '\\bkpn\\b', 'ziggo', 'free sas', 'proxad', 'bouygues', '\\bsfr\\b', 'iliad', 'fastweb', 'wind tre', 'telia', 'telenor', 'tele2', 'elisa',
  'airtel', '\\bjio\\b', 'reliance', 'bsnl', 'pldt', 'globe telecom', 'singtel', 'starhub', 'optus', 'telstra', '\\btpg\\b', 'chinanet', 'china (telecom|unicom|mobile)', 'ntt', 'kddi', 'softbank', 'korea telecom', '\\bsk broadband\\b', 'turk ?telekom', 'turkcell', 'ptcl', 'jazz', 'mtn', 'safaricom', 'maroc telecom', 'claro', 'telmex',
  'amazon', '\\baws\\b', 'microsoft', 'azure', 'google', 'digitalocean', '\\bovh', 'hetzner', 'linode', 'akamai', 'cloudflare', 'fastly', 'zscaler', 'leaseweb', 'contabo', 'vultr', 'oracle', 'alibaba', 'tencent', 'choopa', 'm247', 'datacamp', 'private relay', 'icloud'
].join('|'), 'i');
const isNetwork = company => !company || NETWORK_RE.test(String(company));

// One batch of events from the browser. Returns the number of commands sent.
async function ingest(body, req) {
  if (!configured()) return 0;
  const sid = body.sid, vid = body.vid;
  if (!isId(sid) || !isId(vid) || !Array.isArray(body.events) || !body.events.length) throw new Error('Invalid batch');
  const seq = Math.max(0, Math.min(1e6, Number(body.seq) || 0));
  const events = body.events.filter(e => e && typeof e === 'object' && typeof e.type === 'number' && typeof e.timestamp === 'number');
  if (!events.length) throw new Error('No events');
  const now = Date.now();
  const first = events[0].timestamp, last = events[events.length - 1].timestamp;
  const h = req && req.headers ? req.headers : {};
  const geo = { country: str(h['x-vercel-ip-country'], 4).toUpperCase(), region: str(h['x-vercel-ip-country-region'], 60), city: (() => { try { return decodeURIComponent(str(h['x-vercel-ip-city'], 80)); } catch { return str(h['x-vercel-ip-city'], 80); } })() };

  const sKey = 'ins:s:' + sid, pKey = 'ins:p:' + sid, cKey = 'ins:c:' + sid;
  const cmds = [];
  const inc = (key, field, n = 1) => cmds.push(['HINCRBY', key, field, n]);
  const day = dayOf(last);
  let bytes = 0;

  // Session summary
  cmds.push(['HSETNX', sKey, 'start', String(first)]);
  cmds.push(['HSETNX', sKey, 'vid', vid]);
  cmds.push(['HSET', sKey, 'last', String(Math.max(last, now - 1))]);
  if (geo.country) cmds.push(['HSETNX', sKey, 'country', geo.country]);
  if (geo.city) cmds.push(['HSETNX', sKey, 'city', geo.city]);
  if (geo.region) cmds.push(['HSETNX', sKey, 'region', geo.region]);
  cmds.push(['ZADD', 'ins:idx', 'NX', String(first), sid]);

  // Walk custom events for stats and flags
  for (const e of events) {
    if (e.type !== 5 || !e.data || typeof e.data !== 'object') continue;
    const tag = str(e.data.tag, 40), p = e.data.payload && typeof e.data.payload === 'object' ? e.data.payload : {};
    const d = dayOf(e.timestamp);
    if (tag === 'pageview') {
      const path = str(p.path || '/', 200), title = str(p.title, 160), ref = str(p.ref, 500);
      const dev = device(p.ua);
      cmds.push(['RPUSH', pKey, JSON.stringify({ path, title, t: e.timestamp })], ['LTRIM', pKey, -MAX_PAGES, -1]);
      inc(sKey, 'pages'); inc(sKey, 'pg:' + path);
      cmds.push(['HSETNX', sKey, 'entry', path], ['HSETNX', sKey, 'device', dev.device], ['HSETNX', sKey, 'os', dev.os], ['HSETNX', sKey, 'browser', dev.browser]);
      cmds.push(['HSETNX', sKey, 'w', String(Number(p.w) || 0)], ['HSETNX', sKey, 'h', String(Number(p.h) || 0)], ['HSETNX', sKey, 'lang', str(p.lang, 20)]);
      const src = source(ref, p.utm);
      cmds.push(['HSETNX', sKey, 'source', src], ['HSETNX', sKey, 'ref', hostOf(ref) || '']);
      if (p.utm && p.utm.utm_campaign) cmds.push(['HSETNX', sKey, 'campaign', str(p.utm.utm_campaign, 100)]);
      inc('ins:d:' + d, 'pv'); inc('ins:d:' + d, 'p:' + path);
      if (p.newSession) {
        inc('ins:d:' + d, 's'); inc('ins:d:' + d, 'src:' + src); inc('ins:d:' + d, 'dv:' + dev.device); inc('ins:d:' + d, 'br:' + dev.browser);
        if (geo.country) inc('ins:d:' + d, 'c:' + geo.country);
        if (hostOf(ref) && !/bpohive\.com$/.test(hostOf(ref))) inc('ins:d:' + d, 'r:' + hostOf(ref).slice(0, 80));
        cmds.push(['HSET', sKey, 'new', '1']);
      }
    } else if (tag === 'popup_open') { cmds.push(['HSETNX', sKey, 'popup', '1']); inc('ins:d:' + d, 'f:open'); }
    else if (tag === 'popup_submit') { cmds.push(['HSETNX', sKey, 'submit', '1']); inc('ins:d:' + d, 'f:submit'); }
    else if (tag === 'booked') { cmds.push(['HSETNX', sKey, 'booked', '1']); inc('ins:d:' + d, 'f:booked'); }
    else if (tag === 'form_submit') { inc(sKey, 'forms'); inc('ins:f:' + d, 'submit|' + str(p.form, 80)); }
    else if (tag === 'field') {
      const form = str(p.form, 80), name = str(p.name, 60);
      if (p.k === 'focus') { inc('ins:f:' + d, 'focus|' + form + '|' + name); cmds.push(['HSET', sKey, 'lastField', form + '|' + name]); inc(sKey, 'fields'); }
      if (p.k === 'filled') inc('ins:f:' + d, 'filled|' + form + '|' + name);
    } else if (tag === 'scroll_depth') { const pct = Math.max(0, Math.min(100, Number(p.pct) || 0)); inc('ins:d:' + d, 'sd:' + str(p.path || '/', 200), pct); inc('ins:d:' + d, 'sdn:' + str(p.path || '/', 200)); cmds.push(['HSET', sKey, 'scroll', String(pct)]); }
    else if (tag === 'js_error') { inc(sKey, 'errors'); inc('ins:d:' + d, 'err'); }
    else if (tag === 'org') {
      const company = str(p.company, 100).trim(), asn = str(p.asn, 120).trim();
      if (company) cmds.push(['HSETNX', sKey, 'company', company], ['HSETNX', sKey, 'net', isNetwork(company) ? '1' : '0']);
      if (asn) cmds.push(['HSETNX', sKey, 'asn', asn]);
    }
  }

  // Recording chunk (compressed)
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(events)), { level: 6 }).toString('base64');
  bytes = gz.length + 24;
  cmds.push(['RPUSH', cKey, String(seq) + '|' + gz], ['LTRIM', cKey, -MAX_CHUNKS, -1]);
  inc(sKey, 'events', events.length); inc(sKey, 'bytes', bytes);
  cmds.push(['INCRBY', 'ins:bytes', bytes]);
  cmds.push(['EXPIRE', sKey, KEEP_SEC], ['EXPIRE', pKey, KEEP_SEC], ['EXPIRE', cKey, KEEP_SEC], ['EXPIRE', 'ins:d:' + day, KEEP_SEC + 10 * 86400], ['EXPIRE', 'ins:f:' + day, KEEP_SEC + 10 * 86400]);
  const results = await pipe(cmds);
  // Stay inside the storage budget: drop the oldest sessions when over.
  const used = Number(results[results.length - 6]) || 0; // INCRBY result
  if (used > BUDGET && seq <= 1) await prune(used);
  return cmds.length;
}

async function prune(used) {
  const [expiredFirst] = await pipe([['ZRANGEBYSCORE', 'ins:idx', '-inf', String(Date.now() - KEEP_SEC * 1000), 'LIMIT', 0, 200]]);
  if (expiredFirst && expiredFirst.length) await removeSessions(expiredFirst, false);
  let guard = 0;
  while (used > BUDGET * 0.9 && guard++ < 10) {
    const [oldest] = await pipe([['ZRANGE', 'ins:idx', 0, 24]]);
    if (!oldest || !oldest.length) break;
    const sizes = await pipe(oldest.map(id => ['HGET', 'ins:s:' + id, 'bytes']));
    const freed = sizes.reduce((a, b) => a + (Number(b) || 0), 0);
    await removeSessions(oldest, true);
    used -= freed;
  }
}

async function removeSessions(ids, count) {
  const cmds = [];
  for (const id of ids) {
    if (!isId(id)) continue;
    if (count) cmds.push(['HGET', 'ins:s:' + id, 'bytes']);
    cmds.push(['DEL', 'ins:s:' + id, 'ins:p:' + id, 'ins:c:' + id], ['ZREM', 'ins:idx', id]);
  }
  const res = await pipe(cmds);
  if (count) {
    let freed = 0, i = 0;
    for (const id of ids) { if (!isId(id)) continue; freed += Number(res[i]) || 0; i += 3; }
    if (freed) await pipe([['DECRBY', 'ins:bytes', freed]]);
  }
}

function parseHash(arr) { const o = {}; if (!Array.isArray(arr)) return o; for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; }
function sessionRow(id, h) {
  if (!h || !h.start) return null;
  const start = Number(h.start), last = Number(h.last) || start;
  return {
    id, vid: h.vid || '', start, last, duration: Math.max(0, Math.round((last - start) / 1000)),
    country: h.country || '', city: h.city || '', company: h.company || '', network: h.company ? h.net === '1' : false, region: h.region || '', device: h.device || '', os: h.os || '', browser: h.browser || '',
    w: Number(h.w) || 0, h: Number(h.h) || 0, lang: h.lang || '', entry: h.entry || '/', source: h.source || 'direct', ref: h.ref || '', campaign: h.campaign || '',
    pages: Number(h.pages) || 0, events: Number(h.events) || 0, bytes: Number(h.bytes) || 0, errors: Number(h.errors) || 0, scroll: Number(h.scroll) || 0,
    popup: h.popup === '1', submit: h.submit === '1', booked: h.booked === '1', fields: Number(h.fields) || 0, lastField: h.lastField || '', forms: Number(h.forms) || 0,
    paths: Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith('pg:')).map(([k, v]) => [k.slice(3), Number(v) || 0])), ai: isAI(h.source)
  };
}

async function listSessions(offset = 0, limit = 200, days = 0) {
  const range = days > 0 ? ['ZREVRANGEBYSCORE', 'ins:idx', '+inf', String(Date.now() - days * 86400000), 'LIMIT', offset, limit] : ['ZREVRANGE', 'ins:idx', offset, offset + limit - 1];
  const [ids, total] = await pipe([range, ['ZCARD', 'ins:idx']]);
  if (!ids || !ids.length) return { rows: [], total: Number(total) || 0 };
  const hashes = await pipe(ids.map(id => ['HGETALL', 'ins:s:' + id]));
  const rows = ids.map((id, i) => sessionRow(id, parseHash(hashes[i]))).filter(Boolean);
  return { rows, total: Number(total) || 0 };
}

async function getSession(id) {
  if (!isId(id)) return null;
  const [h, pages, n] = await pipe([['HGETALL', 'ins:s:' + id], ['LRANGE', 'ins:p:' + id, 0, -1], ['LLEN', 'ins:c:' + id]]);
  const row = sessionRow(id, parseHash(h));
  if (!row) return null;
  row.pageList = (pages || []).map(p => { try { return JSON.parse(p); } catch { return null; } }).filter(Boolean);
  row.chunks = Number(n) || 0;
  return row;
}

// Decompressed events for chunks [from, to] (inclusive), sorted by time.
async function getEvents(id, from = 0, to = -1) {
  if (!isId(id)) return [];
  const [chunks] = await pipe([['LRANGE', 'ins:c:' + id, from, to]]);
  const out = [];
  for (const c of chunks || []) {
    const bar = c.indexOf('|');
    try { const arr = JSON.parse(zlib.gunzipSync(Buffer.from(c.slice(bar + 1), 'base64')).toString()); if (Array.isArray(arr)) out.push(...arr); } catch { /* skip a bad chunk */ }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

async function deleteSession(id) { if (!isId(id)) return false; await removeSessions([id], true); return true; }

function dayKeys(days, prefix) { const out = []; const t = Date.now(); for (let i = days - 1; i >= 0; i--) out.push(prefix + dayOf(t - i * 86400000)); return out; }

async function overview(days = 30) {
  days = Math.max(1, Math.min(120, Number(days) || 30));
  const keys = dayKeys(days, 'ins:d:');
  const res = await pipe(keys.map(k => ['HGETALL', k]).concat([['GET', 'ins:bytes'], ['ZCARD', 'ins:idx']]));
  const daily = [], agg = { pv: 0, s: 0, err: 0, open: 0, submit: 0, booked: 0 };
  const top = { pages: {}, sources: {}, referrers: {}, countries: {}, devices: {}, browsers: {} }, sd = {}, sdn = {};
  keys.forEach((k, i) => {
    const h = parseHash(res[i]); const d = { date: k.slice(6), pv: Number(h.pv) || 0, s: Number(h.s) || 0, open: Number(h['f:open']) || 0, submit: Number(h['f:submit']) || 0, booked: Number(h['f:booked']) || 0, err: Number(h.err) || 0 };
    daily.push(d); agg.pv += d.pv; agg.s += d.s; agg.err += d.err; agg.open += d.open; agg.submit += d.submit; agg.booked += d.booked;
    for (const [f, v] of Object.entries(h)) {
      const n = Number(v) || 0, i2 = f.indexOf(':'); if (i2 < 0) continue; const kind = f.slice(0, i2), name = f.slice(i2 + 1);
      const bucket = { p: 'pages', src: 'sources', r: 'referrers', c: 'countries', dv: 'devices', br: 'browsers' }[kind];
      if (bucket) top[bucket][name] = (top[bucket][name] || 0) + n;
      else if (kind === 'sd') sd[name] = (sd[name] || 0) + n; else if (kind === 'sdn') sdn[name] = (sdn[name] || 0) + n;
    }
  });
  const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, n]) => ({ name, n }));
  const scroll = Object.keys(sdn).map(p => ({ path: p, pct: Math.round(sd[p] / sdn[p]), n: sdn[p] })).sort((a, b) => b.n - a.n).slice(0, 25);
  return { days, daily, totals: agg, pages: sorted(top.pages), sources: sorted(top.sources), referrers: sorted(top.referrers), countries: sorted(top.countries), devices: sorted(top.devices), browsers: sorted(top.browsers), scroll, storage: { bytes: Number(res[res.length - 2]) || 0, budget: BUDGET, sessions: Number(res[res.length - 1]) || 0, keepDays: KEEP_DAYS } };
}

async function forms(days = 30) {
  days = Math.max(1, Math.min(120, Number(days) || 30));
  const keys = dayKeys(days, 'ins:f:');
  const res = await pipe(keys.map(k => ['HGETALL', k]));
  const byForm = {};
  keys.forEach((k, i) => {
    const h = parseHash(res[i]);
    for (const [f, v] of Object.entries(h)) {
      const n = Number(v) || 0, parts = f.split('|');
      const kind = parts[0], form = parts[1] || '', field = parts[2] || '';
      const F = byForm[form] = byForm[form] || { form, submits: 0, fields: {} };
      if (kind === 'submit') F.submits += n;
      else if (field) { const x = F.fields[field] = F.fields[field] || { name: field, focus: 0, filled: 0 }; x[kind] = (x[kind] || 0) + n; }
    }
  });
  // Where people stop: the last field touched in sessions that opened the pop-up and never submitted.
  const since = Date.now() - days * 86400000;
  const [ids] = await pipe([['ZRANGEBYSCORE', 'ins:idx', String(since), '+inf', 'LIMIT', 0, 2000]]);
  const abandon = {};
  if (ids && ids.length) {
    const rows = await pipe(ids.map(id => ['HMGET', 'ins:s:' + id, 'lastField', 'submit', 'forms', 'popup']));
    rows.forEach(r => { if (!r || !r[0] || r[1] === '1' || Number(r[2]) > 0) return; const [form, field] = String(r[0]).split('|'); const F = byForm[form]; if (!F) return; F.fields[field] = F.fields[field] || { name: field, focus: 0, filled: 0 }; F.fields[field].abandon = (F.fields[field].abandon || 0) + 1; abandon[form] = (abandon[form] || 0) + 1; });
  }
  return { days, forms: Object.values(byForm).map(F => ({ form: F.form, submits: F.submits, abandoned: abandon[F.form] || 0, fields: Object.values(F.fields).sort((a, b) => b.focus - a.focus) })).sort((a, b) => b.fields.reduce((x, y) => x + y.focus, 0) - a.fields.reduce((x, y) => x + y.focus, 0)) };
}

module.exports = { configured, isAI, isNetwork, ingest, listSessions, getSession, getEvents, deleteSession, overview, forms, device, source, _setPipe: fn => { pipeImpl = fn; } };
