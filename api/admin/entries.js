const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured, listEntries, listAbandoned, removeItem } = require('../../lib/entries.cjs');
const capi = require('../../lib/meta-capi.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'DELETE', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!signedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  if (!configured()) return res.status(503).json({ error: 'The entries database is not connected yet.' });
  // One-off: re-send qualified real estate recruiting leads from the last 7 days to Meta from the server
  // (Meta only accepts events up to 7 days old). POST /api/admin/entries?action=meta-backfill
  if (req.method === 'POST') {
    if (req.query?.action !== 'meta-backfill') return res.status(400).json({ error: 'Unknown action.' });
    if (!capi.configured()) return res.status(503).json({ error: 'META_CAPI_TOKEN is not set in Vercel yet.' });
    const cutoff = Date.now() - 7 * 86400000 + 3600000;
    const rows = (await listEntries()).filter(r => r.form === 'Real estate recruiting' && r.fields?.status === 'Qualified' && Date.parse(r.at) > cutoff);
    const results = [];
    for (const r of rows) {
      const parts = String(r.fields.name || '').trim().split(/\s+/);
      const out = await capi.sendLead({
        email: r.fields.email, phone: r.fields.phone, firstName: parts[0], lastName: parts.slice(1).join(' '),
        pageUrl: r.page, eventId: r.fields.eventId || 'backfill_' + r.id, eventTimeMs: Date.parse(r.at)
      });
      results.push({ name: r.fields.name, at: r.at, sent: out.sent, reason: out.reason || '' });
    }
    return res.status(200).json({ count: results.length, results });
  }
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
