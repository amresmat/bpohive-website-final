const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured, listEntries, listAbandoned, removeItem } = require('../../lib/entries.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!signedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (!configured()) return res.status(503).json({ error: 'The entries database is not connected yet.' });
  if (req.method === 'DELETE') {
    try {
      const ok = await removeItem(req.query?.view === 'abandoned' ? 'abandoned' : 'entries', String(req.query?.id || ''));
      return ok ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'Entry not found.' });
    } catch (e) {
      console.error('Entry delete failed:', e.message);
      return res.status(500).json({ error: 'Could not delete the entry.' });
    }
  }
  try {
    const view = req.query?.view === 'abandoned' ? 'abandoned' : 'entries';
    const rows = view === 'abandoned' ? await listAbandoned() : await listEntries();
    return res.status(200).json({ view, rows });
  } catch (e) {
    console.error('Entries read failed:', e.message);
    return res.status(500).json({ error: 'Could not load entries.' });
  }
};
