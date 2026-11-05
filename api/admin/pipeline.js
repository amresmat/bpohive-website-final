// Admin "Pipeline": every lead (website + callers' sheets) and every Calendly meeting in one place.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured } = require('../../lib/entries.cjs');
const pl = require('../../lib/pipeline.cjs');

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
  try {
    if (req.method === 'GET') return res.status(200).json(await pl.snapshot({ sync: req.query?.sync !== '0' }));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = await body(req);
    if (b.action === 'outcome') return res.status(200).json(await pl.setOutcome(String(b.id || ''), String(b.outcome || '')));
    if (b.action === 'lead') return res.status(200).json(await pl.setLead(String(b.key || ''), { stage: b.stage, type: b.type, note: b.note }));
    if (b.action === 'sync') return res.status(200).json(await pl.syncCalendly({ force: true, budgetMs: 8000 }));
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('Pipeline failed:', e.message);
    return res.status(/Unknown/.test(e.message) ? 400 : 500).json({ error: /Unknown/.test(e.message) ? e.message : 'Could not load the pipeline.' });
  }
};
