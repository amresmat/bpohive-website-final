// Gives the "Finish your request" link in a follow-up email the answers that person already typed,
// so the pop-up opens filled in. The link is signed, so it only works for that person's own form.
const { resume } = require('../../lib/followup.cjs');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try { const f = await resume((req.query && req.query.t) || ''); return f ? res.status(200).json({ fields: f }) : res.status(404).json({ error: 'Not found' }); }
  catch (e) { console.error('Resume failed:', e.message); return res.status(500).json({ error: 'Could not load' }); }
};
