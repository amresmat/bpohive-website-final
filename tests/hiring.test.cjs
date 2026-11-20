const test = require('node:test');
const assert = require('node:assert');
const hr = require('../lib/hiring.cjs');

function fakeRedis() {
  const H = new Map(), S = new Map();
  const run = ([cmd, k, ...a]) => {
    if (cmd === 'HSET') { const h = H.get(k) || new Map(); H.set(k, h); h.set(a[0], String(a[1])); return 1; }
    if (cmd === 'HGET') { const h = H.get(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
    if (cmd === 'HGETALL') { const h = H.get(k); return h ? [...h.entries()].flat() : []; }
    if (cmd === 'HDEL') { const h = H.get(k); return h && h.delete(a[0]) ? 1 : 0; }
    if (cmd === 'GET') return S.has(k) ? S.get(k) : null;
    if (cmd === 'SET') { S.set(k, String(a[0])); return 'OK'; }
    if (cmd === 'DEL') { [k, ...a].forEach(x => S.delete(x)); return 1; }
    if (cmd === 'INCR') { const v = (Number(S.get(k)) || 0) + 1; S.set(k, String(v)); return v; }
    if (cmd === 'EXPIRE') return 1;
    throw new Error('unsupported ' + cmd);
  };
  return { pipe: async cmds => cmds.map(run), H, S };
}
const req = { headers: { 'x-vercel-oidc-token': 'oidc' } };
const tiny = Buffer.from('audio').toString('base64');

test('a candidate starts, answers four times, and gets a weighted score', async () => {
  const r = fakeRedis(), sent = []; hr._setPipe(r.pipe);
  hr._setFetch(async (u, o) => {
    const b = JSON.parse(o.body); sent.push({ u, b, auth: o.headers.Authorization });
    const n = sent.length;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Sure: {"transcript":"Hi Mike, this is Sara","clarity":' + (80 + n) + ',"english":70,"fluency":60,"sales":50,"note":"Clear opener"}' } }] }) };
  });
  await assert.rejects(hr.start({ name: 'Sara', email: 'sara@x.com' }), /agree/);
  const s = await hr.start({ name: 'Sara Ali', email: 'Sara@X.com', consent: true, country: 'Egypt' }, '1.2.3.4');
  assert.ok(s.id); assert.equal(s.scenario.turns.length, 4);
  for (let t = 0; t < 4; t++) await hr.answer({ id: s.id, turn: t, audio: tiny, wav: tiny, mime: 'audio/webm;codecs=opus', secs: 20 }, req);
  assert.equal(sent.length, 4);
  assert.equal(sent[0].b.model, 'google/gemini-3.6-flash'); assert.equal(sent[0].auth, 'Bearer oidc');
  const file = sent[0].b.messages[0].content.find(x => x.type === 'file'); assert.equal(file.file.media_type, 'audio/wav');
  assert.match(sent[0].b.messages[0].content[0].text, /Do NOT lower the score for having a non-native accent/);
  await hr.finish({ id: s.id });
  const { candidates } = await hr.list();
  const c = candidates[0];
  assert.equal(c.email, 'sara@x.com'); assert.equal(c.status, 'done');
  assert.deepEqual(c.scores, { clarity: 83, english: 70, fluency: 60, sales: 50, overall: Math.round(83 * 0.35 + 50 * 0.3 + 70 * 0.2 + 60 * 0.15) });
  const a = await hr.audio(s.id, 2); assert.equal(a.mime, 'audio/webm'); assert.equal(a.data.toString(), 'audio');
  await assert.rejects(hr.answer({ id: s.id, turn: 0, audio: tiny, wav: tiny }, req), /already finished/);
});

test('skipped answers count as zero, failed scoring is kept for review, and bots are slowed down', async () => {
  const r = fakeRedis(); hr._setPipe(r.pipe);
  hr._setFetch(async () => ({ ok: false, status: 402, text: async () => '{"error":{"message":"No credits"}}' }));
  const s = await hr.start({ name: 'Omar', email: 'o@x.com', consent: true });
  await hr.answer({ id: s.id, turn: 0, audio: tiny, wav: tiny }, req);
  let c = (await hr.list()).candidates[0];
  assert.match(c.turns[0].error, /402/);
  hr._setFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"transcript":"x","clarity":80,"english":80,"fluency":80,"sales":80,"note":""}' } }] }) }));
  await hr.answer({ id: s.id, turn: 1, audio: tiny, wav: tiny }, req);
  await hr.finish({ id: s.id });
  c = (await hr.list()).candidates[0];
  assert.equal(c.scores.overall, 40, 'answered 2 of 4: the score is halved');
  assert.equal(c.partial, true, 'one answer could not be scored, so the team knows to listen');
  await assert.rejects(hr.answer({ id: s.id, turn: 9, audio: tiny, wav: tiny }, req), /already finished|unknown question/);
  for (let i = 0; i < 6; i++) await hr.start({ name: 'Bot', email: 'b@x.com', consent: true }, '9.9.9.9');
  await assert.rejects(hr.start({ name: 'Bot', email: 'b@x.com', consent: true }, '9.9.9.9'), /Too many/);
});

test('the team rates candidates, sets the pass mark, and can delete', async () => {
  const r = fakeRedis(); hr._setPipe(r.pipe);
  const s = await hr.start({ name: 'Ali', email: 'a@x.com', consent: true });
  assert.equal((await hr.getCfg()).pass, 70);
  assert.equal((await hr.setCfg({ pass: 140 })).pass, 100);
  const c = await hr.update(s.id, { rating: 'strong', note: 'Good', team: true });
  assert.equal(c.rating, 'strong'); assert.equal(c.team, true);
  assert.equal((await hr.update(s.id, { rating: 'nope' })).rating, '');
  await hr.remove(s.id);
  assert.equal((await hr.list()).candidates.length, 0);
});
