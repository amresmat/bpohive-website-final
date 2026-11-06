// Tells the admin pages who is signed in: the main admin (everything) or a Pipeline team member.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { getAuth } = require('../../lib/cms-token.cjs');
const team = require('../../lib/team.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!signedIn(req)) {
    let u = null;
    try { u = await team.userFrom(req); } catch {}
    if (u) return res.status(200).json({ signedIn: true, role: 'caller', name: u.name, agents: u.agents, connected: false });
    return res.status(200).json({ signedIn: false, connected: false });
  }
  let connected = false;
  try { const a = await getAuth(); connected = Boolean(a && (a.refresh || !a.expires || a.expires > Date.now())); } catch {}
  return res.status(200).json({ signedIn: true, role: 'admin', connected });
};
