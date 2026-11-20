// Agent assessment: candidates do a short mock cold call on bpohive.com/agent-assessment, turn by turn.
// Each answer is recorded in the browser. A small copy (webm/mp4) is kept for playback, and a 16 kHz WAV
// copy is sent once to Gemini (through the Vercel AI Gateway) to listen and score it. Nothing is rejected
// automatically: candidates are scored, and the team decides.
// Redis keys: hr:c (hash, candidate id -> JSON), hr:a:<id>:<turn> (audio, expires), hr:cfg (pass mark), hr:rl:<ip>.
const crypto = require('crypto');
const { pipe } = require('./entries.cjs');
const intel = require('./intel.cjs');

let _pipe = pipe;
let _fetch = (...a) => fetch(...a);
const P = cmds => _pipe(cmds);
const GW = 'https://ai-gateway.vercel.sh';
const MODEL = process.env.HIRING_MODEL || 'google/gemini-3.6-flash';
const AUDIO_DAYS = 120;
const MAX_AUDIO = 900 * 1024;       // playback copy (base64 characters)
const MAX_WAV = 3 * 1024 * 1024;    // scoring copy (base64 characters), about 45 seconds of 16 kHz mono
const WEIGHTS = { clarity: 0.35, sales: 0.30, english: 0.20, fluency: 0.15 };
const RATINGS = ['strong', 'ok', 'weak'];

// The mock call: a made-up product, one prospect, four turns.
const SCENARIO = {
  product: 'PayPilot',
  what: 'PayPilot is simple software that sends invoices and automatic payment reminders, so small businesses get paid faster. Customers usually get paid about two weeks sooner.',
  prospect: 'Mike Carter, owner of Carter Plumbing in Texas (12 employees)',
  goal: 'Book a 15-minute demo with Mike this week.',
  turns: [
    { say: 'Hello, Carter Plumbing, this is Mike.', task: 'Introduce yourself and say why you are calling.' },
    { say: "Look, we already have a system for our invoicing. We're fine, thanks.", task: 'Handle the objection and keep the conversation going.' },
    { say: "I'm really busy right now. Can you just send me an email?", task: 'Handle the brush-off without losing the call.' },
    { say: "Okay. So how much does it cost, and why should I give you fifteen minutes?", task: 'Answer him and ask for a specific time for the demo.' }
  ]
};

const str = (v, n = 200) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, n);
const parseJSON = s => { try { return JSON.parse(s); } catch { return null; } };
const emailIn = v => { const m = String(v || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? m[0] : ''; };
const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const b64ok = s => typeof s === 'string' && /^[A-Za-z0-9+/=]+$/.test(s);

async function getCfg() { const [raw] = await P([['GET', 'hr:cfg']]); return Object.assign({ pass: 70 }, parseJSON(raw) || {}); }
async function setCfg(x) {
  const cfg = await getCfg();
  if (x.pass !== undefined) cfg.pass = clamp(x.pass);
  await P([['SET', 'hr:cfg', JSON.stringify(cfg)]]);
  return cfg;
}
async function get(id) { const [raw] = await P([['HGET', 'hr:c', String(id)]]); return parseJSON(raw); }
async function put(c) { await P([['HSET', 'hr:c', c.id, JSON.stringify(c)]]); return c; }

// 1. Start: who they are. A few starts per hour per address, to keep bots out.
async function start(x = {}, ip = '') {
  const name = str(x.name, 120), email = emailIn(x.email);
  if (!name) throw new Error('Invalid: type your full name');
  if (!email) throw new Error('Invalid: type a valid email address');
  if (!x.consent) throw new Error('Invalid: please agree to the recording and scoring');
  if (ip) {
    const k = 'hr:rl:' + crypto.createHash('sha1').update(ip).digest('hex').slice(0, 16);
    const [n] = await P([['INCR', k], ['EXPIRE', k, 3600]]);
    if (Number(n) > 6) throw new Error('Too many attempts. Please try again in an hour.');
  }
  const c = {
    id: crypto.randomBytes(9).toString('base64url'), at: Date.now(), name, email, phone: str(x.phone, 40), country: str(x.country, 60),
    experience: str(x.experience, 60), team: Boolean(x.team), source: str(x.source, 120), status: 'started', turns: []
  };
  await put(c);
  return { id: c.id, scenario: SCENARIO };
}

const PROMPT = t => [
  'You are assessing a job candidate for an outbound B2B sales calling job (appointment setting). The calls go to business owners in the USA and the Gulf (GCC).',
  'The candidate is on a mock cold call selling ' + SCENARIO.product + '. ' + SCENARIO.what,
  'The prospect is ' + SCENARIO.prospect + '. The goal of the call: ' + SCENARIO.goal,
  'The prospect just said: "' + SCENARIO.turns[t].say + '"',
  'The candidate\'s task for this answer: ' + SCENARIO.turns[t].task,
  'Listen to the audio of the candidate\'s answer and score it from 0 to 100 on:',
  '- clarity: how easily a US or Gulf business owner would understand them on a phone call (pronunciation, articulation, volume). Do NOT lower the score for having a non-native accent by itself; only lower it when the way they speak makes words hard to understand.',
  '- english: grammar, word choice and natural, professional phrasing.',
  '- fluency: smooth pace, few long pauses or filler words, confident delivery.',
  '- sales: how well this answer does the task (clear reason for calling, handling the objection, keeping control, asking for the meeting), sounding like a real professional caller.',
  'If the audio is silent, cut off, or not English, give low scores and say so in the note.',
  'Reply with JSON only, no other text: {"transcript": "what they said, word for word", "clarity": 0, "english": 0, "fluency": 0, "sales": 0, "note": "one short sentence on the biggest strength or problem"}'
].join('\n');

async function scoreTurn(t, wav, token) {
  const j = await intelGw('/v1/chat/completions', {
    model: MODEL, temperature: 0.1, max_tokens: 1500,
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT(t) }, { type: 'file', file: { data: wav, media_type: 'audio/wav', filename: 'answer-' + (t + 1) + '.wav' } }] }]
  }, token);
  const m = ((j.choices || [])[0] || {}).message || {};
  const text = Array.isArray(m.content) ? m.content.map(x => (x && x.text) || '').join('') : String(m.content || '');
  const r = (/\{[\s\S]*\}/.exec(text) || [])[0];
  const o = parseJSON(r);
  if (!o) throw new Error('The scoring came back empty');
  return { transcript: str(o.transcript, 3000), clarity: clamp(o.clarity), english: clamp(o.english), fluency: clamp(o.fluency), sales: clamp(o.sales), note: str(o.note, 300) };
}
async function intelGw(path, body, token) {
  const r = await _fetch(GW + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
  const txt = await r.text(); const j = parseJSON(txt) || {};
  if (!r.ok) throw new Error('AI scoring failed (' + r.status + '): ' + str((j.error && (j.error.message || j.error)) || txt, 160));
  return j;
}

// 2. One answer: keep the small copy for playback, score the WAV copy.
async function answer(x = {}, req) {
  const c = await get(x.id);
  if (!c) throw new Error('Unknown assessment. Please start again.');
  if (c.status === 'done') throw new Error('This assessment is already finished.');
  const t = Number(x.turn);
  if (!(t >= 0 && t < SCENARIO.turns.length)) throw new Error('Invalid: unknown question');
  if (!b64ok(x.audio) || x.audio.length > MAX_AUDIO) throw new Error('Invalid: the recording could not be read (keep each answer under 45 seconds)');
  if (!b64ok(x.wav) || x.wav.length > MAX_WAV) throw new Error('Invalid: the recording could not be read (keep each answer under 45 seconds)');
  const mime = /^audio\/(webm|mp4|ogg|mpeg|aac|wav)/.test(String(x.mime || '')) ? String(x.mime).split(';')[0] : 'audio/webm';
  await P([['SET', 'hr:a:' + c.id + ':' + t, mime + '|' + x.audio, 'EX', AUDIO_DAYS * 86400]]);
  const turn = { t, at: Date.now(), secs: Math.max(0, Math.min(90, Number(x.secs) || 0)), mime };
  const token = intel.tokenOf(req);
  if (!token) turn.error = 'AI scoring is not set up';
  else {
    try { Object.assign(turn, await scoreTurn(t, x.wav, token)); }
    catch (e) { turn.error = str(e.message, 200); }
  }
  const fresh = (await get(c.id)) || c;
  fresh.turns = (fresh.turns || []).filter(y => y.t !== t).concat(turn).sort((a, b) => a.t - b.t);
  await put(fresh);
  return { ok: true };
}

function totals(turns) {
  const scored = turns.filter(t => !t.error && typeof t.clarity === 'number');
  if (!scored.length) return null;
  const avg = k => Math.round(scored.reduce((s, t) => s + t[k], 0) / scored.length);
  const s = { clarity: avg('clarity'), english: avg('english'), fluency: avg('fluency'), sales: avg('sales') };
  s.overall = Math.round(Object.keys(WEIGHTS).reduce((n, k) => n + s[k] * WEIGHTS[k], 0));
  return s;
}

// 3. Finish: add up the scores. Missing answers count as zero so skipping does not help.
async function finish(x = {}) {
  const c = await get(x.id);
  if (!c) throw new Error('Unknown assessment. Please start again.');
  const answered = (c.turns || []).length;
  const s = totals(c.turns || []);
  if (s && answered < SCENARIO.turns.length) Object.keys(s).forEach(k => { s[k] = Math.round(s[k] * answered / SCENARIO.turns.length); });
  c.scores = s; c.partial = (c.turns || []).some(t => t.error); c.status = 'done'; c.doneAt = Date.now();
  await put(c);
  return { ok: true };
}

async function list() {
  const [raw, cfg] = await Promise.all([P([['HGETALL', 'hr:c']]).then(r => r[0] || []), getCfg()]);
  const out = [];
  for (let i = 0; i < raw.length; i += 2) { const c = parseJSON(raw[i + 1]); if (c) out.push(c); }
  out.sort((a, b) => b.at - a.at);
  return { candidates: out, cfg, scenario: SCENARIO, weights: WEIGHTS };
}
async function audio(id, t) {
  const [raw] = await P([['GET', 'hr:a:' + String(id) + ':' + Number(t)]]);
  if (!raw) return null;
  const i = raw.indexOf('|');
  return { mime: raw.slice(0, i), data: Buffer.from(raw.slice(i + 1), 'base64') };
}
async function update(id, x = {}) {
  const c = await get(id); if (!c) throw new Error('Unknown candidate');
  if (x.rating !== undefined) c.rating = RATINGS.includes(x.rating) ? x.rating : '';
  if (x.note !== undefined) c.note = str(x.note, 1000);
  if (x.team !== undefined) c.team = Boolean(x.team);
  return put(c);
}
async function remove(id) {
  const keys = SCENARIO.turns.map((_, t) => 'hr:a:' + String(id) + ':' + t);
  await P([['HDEL', 'hr:c', String(id)], ['DEL', ...keys]]);
  return { ok: true };
}

module.exports = { SCENARIO, WEIGHTS, start, answer, finish, list, audio, update, remove, getCfg, setCfg, totals, _setPipe: f => { _pipe = f; }, _setFetch: f => { _fetch = f; } };
