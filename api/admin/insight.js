// Admin-only reads for the Analytics section: overview numbers, session list, replay events, form stats.
const { signedIn } = require('../../lib/admin-auth.cjs');
const ins = require('../../lib/insight.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!signedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (!ins.configured()) return res.status(503).json({ error: 'The analytics database is not connected yet.' });
  const q = req.query || {};
  try {
    if (req.method === 'DELETE') {
      const ok = await ins.deleteSession(String(q.id || ''));
      return ok ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'Session not found.' });
    }
    const view = String(q.view || 'overview');
    if (view === 'overview') return res.status(200).json(await ins.overview(q.days));
    if (view === 'forms') return res.status(200).json(await ins.forms(q.days));
    if (view === 'sessions') return res.status(200).json(await ins.listSessions(Math.max(0, Number(q.offset) || 0), Math.min(3000, Math.max(1, Number(q.limit) || 200)), Math.max(0, Math.min(120, Number(q.days) || 0))));
    if (view === 'session') { const s = await ins.getSession(String(q.id || '')); return s ? res.status(200).json(s) : res.status(404).json({ error: 'Session not found.' }); }
    if (view === 'events') {
      const from = Math.max(0, Number(q.from) || 0), to = q.to === undefined ? -1 : Math.max(from, Number(q.to) || 0);
      return res.status(200).json({ events: await ins.getEvents(String(q.id || ''), from, to) });
    }
    return res.status(400).json({ error: 'Unknown view' });
  } catch (e) {
    console.error('Insight read failed:', e.message);
    return res.status(500).json({ error: 'Could not load analytics.' });
  }
};
