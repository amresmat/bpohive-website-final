// Public endpoint for the agent assessment page (bpohive.com/agent-assessment): start, send each answer, finish.
const { configured } = require('../lib/entries.cjs');
const hr = require('../lib/hiring.cjs');

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const ipOf = req => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || '').trim();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'The assessment is not available right now.' });
  let b;
  try { b = await body(req); } catch { return res.status(400).json({ error: 'Invalid request' }); }
  try {
    if (b.action === 'start') return res.status(200).json(await hr.start(b, ipOf(req)));
    if (b.action === 'answer') return res.status(200).json(await hr.answer(b, req));
    if (b.action === 'finish') return res.status(200).json(await hr.finish(b));
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    const known = /^(Invalid|Unknown|Too many|This assessment)/.test(e.message);
    if (!known) console.error('Agent assessment failed:', e.message);
    return res.status(known ? 400 : 500).json({ error: known ? e.message.replace(/^Invalid: /, '') : 'Something went wrong. Please try again.' });
  }
};
