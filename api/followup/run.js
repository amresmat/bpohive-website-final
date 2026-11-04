// Sends due follow-up emails. Called by the daily Vercel cron, and also triggered by normal
// site traffic (at most every 10 minutes) so emails go out about an hour after a form is abandoned.
const { run } = require('../../lib/followup.cjs');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const auth = String(req.headers.authorization || '');
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try { const r = await run(); return res.status(200).json({ ran: r.ran, live: r.live, due: r.due, sent: (r.results || []).filter(x => x.status === 'sent').length }); }
  catch (e) { console.error('Follow-up run failed:', e.message); return res.status(500).json({ error: 'Run failed' }); }
};
