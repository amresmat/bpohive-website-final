// Admin: follow-up email status, history, who is due next, a preview of both emails, and a manual run.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured } = require('../../lib/entries.cjs');
const fu = require('../../lib/followup.cjs');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!signedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (!configured()) return res.status(503).json({ error: 'The database is not connected yet.' });
  try {
    if (req.method === 'POST') { const r = await fu.run({ force: true }); return res.status(200).json(r); }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const [log, due] = await Promise.all([fu.log(), fu.candidates()]);
    return res.status(200).json({
      live: fu.enabled(), hasKey: Boolean(process.env.BREVO_API_KEY), switchOn: process.env.FOLLOWUP_ENABLED === '1',
      sender: fu.SENDER, preview: fu.preview(), log: log.rows, unsubscribed: log.unsubscribed,
      due: due.map(c => ({ email: c.d.email, name: fu.firstName(c.d.fields || {}), company: (c.d.fields || {}).company || '', step: c.step, why: c.why || '', page: c.d.page || '', updated: c.d.updated }))
    });
  } catch (e) { console.error('Follow-up admin failed:', e.message); return res.status(500).json({ error: 'Could not load follow-ups.' }); }
};
