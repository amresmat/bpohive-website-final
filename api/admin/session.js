// Tells the admin pages whether the visitor is signed in and whether GitHub is connected.
const { signedIn } = require('../../lib/admin-auth.cjs');
const { getAuth } = require('../../lib/cms-token.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!signedIn(req)) return res.status(200).json({ signedIn: false, connected: false });
  let connected = false;
  try { const a = await getAuth(); connected = Boolean(a && (a.refresh || !a.expires || a.expires > Date.now())); } catch {}
  return res.status(200).json({ signedIn: true, connected });
};
