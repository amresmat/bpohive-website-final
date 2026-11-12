// Lead intel for the Pipeline cards, made once per lead and kept in Redis (hash pl:intel, field = lead key):
//   company: what the lead's company does, industry, HQ, size, revenue, founded, links (web research)
//   calls:   a short summary of each booking-call recording from the Lead Entry sheets (transcribed)
// Everything goes through Vercel AI Gateway with the deployment's own OIDC token, so no API key is needed.
// Salesfinity links need a Salesfinity login, so those calls can't be summarized here.
const { pipe } = require('./entries.cjs');

let _pipe = pipe;
let _fetch = (...a) => fetch(...a);
const P = cmds => _pipe(cmds);
const GW = 'https://ai-gateway.vercel.sh';
const M_RESEARCH = process.env.INTEL_RESEARCH_MODEL || 'perplexity/sonar';
const M_TEXT = process.env.INTEL_TEXT_MODEL || 'anthropic/claude-haiku-4.5';
const M_STT = process.env.INTEL_STT_MODEL || 'openai/gpt-4o-mini-transcribe';
const MAX_AUDIO = 24 * 1024 * 1024;
const RETRY_MS = 24 * 3600e3;        // a failed lookup is tried again a day later
const MAX_TRIES = 3;
const FREE_MAIL = /^(gmail|googlemail|hotmail|yahoo|ymail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\.[a-z.]+$/i;

const str = (v, n = 400) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, n);
const parseJSON = s => { try { return JSON.parse(s); } catch { return null; } };
const tokenOf = req => (req && req.headers && req.headers['x-vercel-oidc-token']) || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || '';
const on = req => Boolean(tokenOf(req));

class GatewayError extends Error { constructor(msg, status) { super(msg); this.status = status; this.fatal = [401, 402, 403].includes(status); } }

async function gw(path, body, token, headers = {}, ms = 45000) {
  const r = await _fetch(GW + path, { method: 'POST', headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const txt = await r.text();
  const j = parseJSON(txt) || {};
  if (!r.ok) {
    const m = (j.error && (j.error.message || j.error)) || txt.slice(0, 200) || ('AI Gateway returned ' + r.status);
    throw new GatewayError(typeof m === 'string' ? m : JSON.stringify(m).slice(0, 200), r.status);
  }
  return j;
}
async function chat(model, messages, token, extra = {}) {
  const j = await gw('/v1/chat/completions', Object.assign({ model, messages, temperature: 0.2 }, extra), token);
  const c = (j.choices || [])[0] || {};
  const m = (c.message && c.message.content) || '';
  const text = Array.isArray(m) ? m.map(x => (x && (x.text || x.content)) || '').join('') : String(m);
  return { text, citations: j.citations || (j.search_results || []).map(x => x.url).filter(Boolean) };
}
const firstJSON = t => { const m = /\{[\s\S]*\}/.exec(String(t || '')); return m ? parseJSON(m[0]) : null; };

/* ---------- Company ---------- */
function domainOf(lead) {
  const d = String(lead.email || '').split('@')[1] || '';
  return d && !FREE_MAIL.test(d) ? d.toLowerCase() : '';
}
function websiteOf(lead) {
  const qa = (lead.qa || []).find(x => /website|domain|url/i.test(x.q || '')), w = (lead.website || []).map(x => (x.fields || {}).website).find(Boolean);
  const v = str((qa && qa.a) || w || '', 200);
  return /\.[a-z]{2,}/i.test(v) ? v : '';
}
function canResearch(lead) { return Boolean(str(lead.company) || domainOf(lead) || websiteOf(lead)); }

async function researchCompany(lead, token) {
  const facts = [
    lead.company && 'Company name (as the lead typed it): ' + str(lead.company, 120),
    websiteOf(lead) && 'Website: ' + websiteOf(lead),
    domainOf(lead) && 'Work email domain: ' + domainOf(lead),
    lead.name && 'Contact: ' + str(lead.name, 80) + (lead.title ? ', ' + str(lead.title, 80) : ''),
    lead.country && 'Country: ' + str(lead.country, 40),
    (lead.verticals || [])[0] && 'Industry guess from our caller: ' + str(lead.verticals[0], 60)
  ].filter(Boolean).join('\n');
  const prompt = 'Research this B2B sales lead\'s company on the web. Use the email domain and website first to identify the right company; the typed name can be short or misspelled.\n\n' + facts +
    '\n\nReply with ONLY a JSON object, no other text:\n{"found":true|false,"name":"official company name","website":"https://...","what":"what they sell and to whom, ONE short sentence, max 18 words","industry":"","hq":"city, country","employees":"e.g. 51-200","revenue":"annual revenue range, e.g. $10M-$50M (est.)","founded":"year","linkedin":"company LinkedIn URL","notes":"one useful fact for a sales call, max 15 words"}\n' +
    'Rules: always give a revenue range. Use the published figure if there is one; otherwise use estimates from ZoomInfo, Apollo, Growjo, Crunchbase, LinkedIn or similar; if none exist, estimate from the employee count and industry. Mark any estimate with "(est.)". Never invent employee counts. If you cannot identify the company with confidence, set "found":false and leave the rest empty.';
  const r = await chat(M_RESEARCH, [{ role: 'user', content: prompt }], token, { max_tokens: 700 });
  const j = firstJSON(r.text);
  if (!j) throw new Error('Could not read the company research');
  const clean = (v, n) => { const s = str(v, n); return /^(unknown|n\/a|none|not (available|found|published)|-)$/i.test(s) ? '' : s; };
  const url = v => { const s = clean(v, 200); return /^https?:\/\/[^\s]+\.[a-z]{2,}/i.test(s) ? s : ''; };
  let revenue = clean(j.revenue, 60);
  if (!revenue && j.found) revenue = revenueFromSize(clean(j.employees, 40));
  return {
    v: 3, found: Boolean(j.found), name: clean(j.name, 120), website: url(j.website), what: clean(j.what, 420), industry: clean(j.industry, 80), hq: clean(j.hq, 80),
    employees: clean(j.employees, 40), revenue, founded: clean(j.founded, 10), linkedin: url(j.linkedin), notes: clean(j.notes, 300),
    sources: (r.citations || []).filter(u => /^https?:\/\//.test(u)).slice(0, 5), at: Date.now()
  };
}

// Rough revenue range from headcount (about $100K-$250K per employee) when nothing better is available.
function revenueFromSize(emp) {
  const nums = String(emp || '').replace(/,/g, '').match(/\d+/g); if (!nums) return '';
  const n = nums.length > 1 && !/\+/.test(emp) ? (Number(nums[0]) + Number(nums[1])) / 2 : Number(nums[0]);
  if (!n) return '';
  const fmt = v => v >= 1e9 ? '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B' : v >= 1e6 ? '$' + Math.round(v / 1e6) + 'M' : '$' + Math.round(v / 1e3) + 'K';
  return fmt(n * 1e5) + '-' + fmt(n * 2.5e5) + ' (est. from size)';
}

/* ---------- Booking-call recordings ---------- */
function audioOf(u) {
  u = String(u || '');
  let m = /^https?:\/\/(?:www\.)?(?:voca\.ro|vocaroo\.com)\/(?:embed\/)?([A-Za-z0-9]+)/i.exec(u); if (m) return 'https://media.vocaroo.com/mp3/' + m[1];
  m = /drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(u); if (m) return 'https://drive.google.com/uc?export=download&id=' + m[1];
  if (/^https:\/\/[^\/]*twil+io[^\/]*\//i.test(u) || /^https:\/\/[^?#]+\.(mp3|wav|m4a|ogg|oga|webm|aac)([?#]|$)/i.test(u)) return u;
  return '';
}
const canSummarize = u => Boolean(audioOf(u));
const recordingsOf = lead => [...new Set((lead.sheetRows || []).map(r => r.recording).filter(u => /^https?:\/\//.test(u || '')))];

async function transcribe(url, token) {
  const r = await _fetch(audioOf(url) || url, { headers: { 'User-Agent': 'Mozilla/5.0 (BPO Hive admin)', Referer: 'https://vocaroo.com/' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('Could not download the recording (' + r.status + ')');
  let type = String(r.headers.get('content-type') || '').split(';')[0].trim();
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error('The recording is empty');
  if (buf.length > MAX_AUDIO) throw new Error('The recording is too long to summarize');
  if (!/^audio\//.test(type)) type = /\.wav/i.test(url) ? 'audio/wav' : 'audio/mpeg';
  const j = await gw('/v4/ai/transcription-model', { audio: buf.toString('base64'), mediaType: type }, token,
    { 'ai-gateway-protocol-version': '0.0.1', 'ai-transcription-model-specification-version': '4', 'ai-model-id': M_STT }, 90000);
  return String(j.text || '').trim();
}

async function summarizeCall(transcript, lead, token) {
  if (transcript.replace(/\W/g, '').length < 40) return { summary: 'The recording has almost no speech.', short: true };
  const prompt = 'This is the transcript of a cold call where our caller (BPO Hive, a B2B appointment-setting company) booked a meeting with ' + (str(lead.name, 80) || 'a prospect') + (lead.company ? ' from ' + str(lead.company, 80) : '') + '. The transcript has no speaker labels.\n\n' +
    'Write a very short summary for our sales team in English: 3 bullet points starting with "- ", each under 12 words. Only the essentials that were actually said: what they need or their pain, budget or timeline if mentioned, and what was agreed. No intro line, no filler.\n\nTranscript:\n' + transcript.slice(0, 24000);
  const r = await chat(M_TEXT, [{ role: 'user', content: prompt }], token, { max_tokens: 1200 });
  const summary = r.text.trim().slice(0, 1500);
  if (!summary) throw new Error('The AI returned an empty summary');
  return { summary };
}

/* ---------- Storage and the queue ---------- */
async function getAll() {
  const [raw] = await P([['HGETALL', 'pl:intel']]);
  const o = {}; for (let i = 0; i < (raw || []).length; i += 2) { const v = parseJSON(raw[i + 1]); if (v) o[raw[i]] = v; }
  return o;
}
const intelFor = (all, lead) => [lead.key].concat(lead.aliases || []).map(k => all[k]).find(Boolean) || null;
const due = x => !x || (x.error && (x.tries || 0) < MAX_TRIES && Date.now() - (x.at || 0) > RETRY_MS);
const SUM_V = 2; // bump to redo existing summaries in a new style

// What is still to do for a lead: the company profile and any recording without a summary.
function todo(lead, it) {
  it = it || {};
  const out = [];
  const co = it.company;
  // Redo older profiles in the current style; a company not found gets one more try.
  if (canResearch(lead) && (due(co) || (co && !co.error && (co.found ? (co.v || 1) < 2 : (co.v || 1) < 3)))) out.push({ kind: 'company' });
  (lead.sfCalls || []).filter(c => c.hasText || c.recording).forEach(c => { const x = (it.calls || {})['sf:' + c.id]; if (due(x) || (x && !x.error && (!x.summary || (x.v || 1) < SUM_V))) out.push({ kind: 'call', url: 'sf:' + c.id, sf: c }); });
  recordingsOf(lead).filter(canSummarize).forEach(u => { const c = (it.calls || {})[u]; if (due(c) || (c && !c.error && (!c.summary || (c.v || 1) < SUM_V))) out.push({ kind: 'call', url: u }); });
  return out;
}

async function save(key, it) { await P([['HSET', 'pl:intel', key, JSON.stringify(it)]]); }
async function state(patch) {
  const [raw] = await P([['GET', 'pl:intel:state']]);
  const s = Object.assign(parseJSON(raw) || {}, patch);
  await P([['SET', 'pl:intel:state', JSON.stringify(s)]]);
  return s;
}

// Fills in one lead (company and call summaries), within the time budget.
async function runLead(lead, it, token, until) {
  it = Object.assign({ calls: {} }, it || {});
  for (const job of todo(lead, it)) {
    if (Date.now() > until) break;
    const prev = job.kind === 'company' ? it.company : it.calls[job.url];
    try {
      if (job.kind === 'company') {
        const found = await researchCompany(lead, token);
        // A second look that can't place the company never wipes a profile found before.
        it.company = !found.found && prev && prev.found ? Object.assign({}, prev, { v: 3, revenue: prev.revenue || revenueFromSize(prev.employees), at: Date.now() }) : found;
      }
      else if (job.sf) {
        const rec = await require('./salesfinity.cjs').one(job.sf.id) || {};
        const text = rec.transcript || (rec.recording ? await transcribe(rec.recording, token) : '') || rec.summary || '';
        if (!text) throw new Error('Salesfinity has no transcript for this call');
        const s = await summarizeCall(text, lead, token); it.calls[job.url] = Object.assign(s, { v: SUM_V, at: Date.now(), words: text.split(/\s+/).length, source: 'salesfinity' });
      }
      else { const text = await transcribe(job.url, token); const s = await summarizeCall(text, lead, token); it.calls[job.url] = Object.assign(s, { v: SUM_V, at: Date.now(), words: text.split(/\s+/).length }); }
    } catch (e) {
      if (e.fatal) throw e;
      const fail = { error: str(e.message, 200), at: Date.now(), tries: ((prev && prev.tries) || 0) + 1 };
      if (job.kind === 'company') it.company = fail; else it.calls[job.url] = fail;
    }
  }
  await save(lead.key, it);
  return it;
}

// Works through leads (newest first, or the order of `keys`) until the time budget runs out.
async function runBatch(leads, req, { budgetMs = 40000, keys = null, max = 3, force = false } = {}) {
  const token = tokenOf(req);
  if (!token) return { skipped: true, reason: 'AI Gateway is not available here' };
  // force ("Retry now" in the admin) ignores a pause, e.g. right after credit was added.
  const st = await state({});
  if (!force && st.pausedUntil && Date.now() < st.pausedUntil) return { paused: true, error: st.error || '' };
  const all = await getAll();
  let list = leads.filter(l => todo(l, intelFor(all, l)).length);
  if (keys && keys.length) { const pos = new Map(keys.map((k, i) => [k, i])); list = list.filter(l => pos.has(l.key)).sort((a, b) => pos.get(a.key) - pos.get(b.key)).concat(list.filter(l => !pos.has(l.key))); }
  const until = Date.now() + budgetMs, done = {};
  let n = 0;
  try {
    for (const l of list) {
      if (Date.now() > until || n >= max) break;
      done[l.key] = await runLead(l, intelFor(all, l), token, until); n++;
    }
  } catch (e) {
    // No credit, or the gateway is not enabled for this project: pause for an hour instead of retrying every lead.
    await state({ error: str(e.message, 200), status: e.status || 0, pausedUntil: Date.now() + 3600e3, at: Date.now() });
    return { done, error: str(e.message, 200), paused: true, remaining: list.length - n };
  }
  if (st.error) await state({ error: '', status: 0, pausedUntil: 0, at: Date.now() });
  return { done, remaining: Math.max(0, list.length - n) };
}

module.exports = { revenueFromSize, on, tokenOf, getAll, intelFor, todo, runLead, runBatch, researchCompany, summarizeCall, transcribe, audioOf, canSummarize, recordingsOf, domainOf, websiteOf, canResearch,
  _setPipe: f => { _pipe = f; }, _setFetch: f => { _fetch = f; } };
