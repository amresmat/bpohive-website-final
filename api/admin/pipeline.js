// Admin "Pipeline": every lead (website + Lead Entry sheets) and every meeting in one place.
// The main admin sees and changes everything. Pipeline team members (callers) only see their own
// leads and appointments, read-only, and never the rest of the admin.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { configured } = require('../../lib/entries.cjs');
const pl = require('../../lib/pipeline.cjs');
const team = require('../../lib/team.cjs');

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Keep only the caller's own leads and the meetings that belong to them.
function forCaller(snap, u) {
  const mine = new Set((u.agents || []).map(a => a.toLowerCase().trim()).filter(Boolean));
  const leads = snap.leads.filter(l => (l.callers || []).some(c => mine.has(String(c).toLowerCase().trim())))
    .map(l => Object.assign({}, l, { note: '', website: [], value: 0, trail: (l.trail || []).filter(x => x.kind === 'stage' || x.kind === 'next') }));
  const keys = new Set(leads.map(l => l.key));
  const meetings = snap.meetings.filter(m => m.leadKey && keys.has(m.leadKey));
  return { leads, meetings, role: 'caller', me: { name: u.name, agents: u.agents }, status: { calendly: { connected: snap.status.calendly.connected, lastSync: snap.status.calendly.lastSync }, sheets: { lastSync: snap.status.sheets.lastSync, files: snap.status.sheets.files.map(f => ({ name: f.name })) }, fathom: { connected: snap.status.fathom.connected, lastSync: snap.status.fathom.lastSync }, website: {} } };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const admin = signedIn(req);
  let user = null;
  if (!admin) { try { user = await team.userFrom(req); } catch {} }
  if (!admin && !user) return res.status(401).json({ error: 'Please sign in.' });
  if (!configured()) return res.status(503).json({ error: 'The database is not connected yet.' });
  try {
    if (req.method === 'GET') {
      const snap = await pl.snapshot({ sync: req.query?.sync !== '0' });
      if (!admin) return res.status(200).json(forCaller(snap, user));
      const [sources, users] = await Promise.all([pl.getSources(), team.all()]);
      return res.status(200).json(Object.assign(snap, { role: 'admin', sources, timezones: pl.TZS, team: users }));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!admin) return res.status(403).json({ error: 'Only the main admin can change this.' });
    const b = await body(req);
    const link = t => 'https://www.bpohive.com/admin/?invite=' + encodeURIComponent(t);
    switch (b.action) {
      case 'outcome': return res.status(200).json(await pl.setOutcome(String(b.id || ''), String(b.outcome || '')));
      case 'update': return res.status(200).json(await pl.updateLead(String(b.key || ''), { note: b.note, deal: b.deal, from: b.from, value: b.value, next: b.next }, b.by));
      case 'note-delete': return res.status(200).json(await pl.deleteNote(String(b.key || ''), String(b.id || '')));
      case 'lead': return res.status(200).json(await pl.setLead(String(b.key || ''), { stage: b.stage, type: b.type, note: b.note }));
      case 'sync': { const [calendly, fathom] = await Promise.all([pl.syncCalendly({ force: true, budgetMs: 8000 }), pl.syncFathom({ force: true, budgetMs: 8000 })]); return res.status(200).json({ calendly, fathom }); }
      case 'sources': return res.status(200).json({ sources: await pl.setSources(b.sources) });
      case 'event-types': return res.status(200).json({ skipped: await pl.setSkippedEvents(b.skipped) });
      case 'team-add': { const r = await team.addUser(b); return res.status(200).json({ user: r.user, invite: link(r.token) }); }
      case 'team-update': return res.status(200).json({ user: await team.updateUser(String(b.id || ''), b) });
      case 'team-invite': { const r = await team.reinvite(String(b.id || '')); return res.status(200).json({ user: r.user, invite: link(r.token) }); }
      case 'team-remove': return res.status(200).json({ ok: await team.removeUser(String(b.id || '')) });
      default: return res.status(400).json({ error: 'Unknown action.' });
    }
  } catch (e) {
    const bad = /^(Unknown|Invalid)/.test(e.message);
    if (!bad) console.error('Pipeline failed:', e.message);
    return res.status(bad ? 400 : 500).json({ error: bad ? e.message.replace(/^(Unknown|Invalid)[^:]*:\s*/, '') : 'Could not load the pipeline.' });
  }
};
