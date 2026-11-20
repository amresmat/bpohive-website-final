// Admin "Agent assessments": every candidate, their scores and recordings, your own rating, and the pass mark.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured } = require('../../lib/entries.cjs');
const hr = require('../../lib/hiring.cjs');

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!signedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (!configured()) return res.status(503).json({ error: 'The database is not connected yet.' });
  const q = req.query || {};
  try {
    if (req.method === 'GET' && q.audio) {
      const a = await hr.audio(String(q.audio), Number(q.turn));
      if (!a) return res.status(404).json({ error: 'Recording not found (recordings are kept for 120 days).' });
      res.setHeader('Content-Type', a.mime); res.setHeader('Content-Length', a.data.length);
      return res.status(200).send(a.data);
    }
    if (req.method === 'GET') return res.status(200).json(await hr.list());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = await body(req);
    if (b.action === 'cfg') return res.status(200).json({ cfg: await hr.setCfg(b) });
    if (b.action === 'update') return res.status(200).json({ candidate: await hr.update(String(b.id || ''), b) });
    if (b.action === 'delete') return res.status(200).json(await hr.remove(String(b.id || '')));
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(/^Unknown/.test(e.message) ? 404 : 500).json({ error: e.message });
  }
};
