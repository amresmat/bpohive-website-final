// Sign in. Main admin: password only. Pipeline team members: email + their own password.
// A team member's first sign-in comes from their invite link (they choose the password then).
const { passwordOk, issue } = require('../../lib/admin-auth.cjs');
const team = require('../../lib/team.cjs');
const attempts = new Map();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', ['bh_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0', team.clearCookie()]); return res.status(200).json({ ok: true }); }
  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return res.status(400).json({ error: 'Invalid' }); }
  if (req.method === 'GET' && req.query && req.query.invite) {
    try { const info = await team.inviteInfo(String(req.query.invite)); return info ? res.status(200).json(info) : res.status(404).json({ error: 'This invite link has expired or was replaced. Ask for a new one.' }); }
    catch { return res.status(500).json({ error: 'Could not check the invite.' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'The admin password has not been set up yet.' });
  const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const tries = (attempts.get(key) || []).filter(t => now - t < 900000);
  if (tries.length >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const fail = async msg => { tries.push(now); attempts.set(key, tries); await new Promise(r => setTimeout(r, 600)); return res.status(401).json({ error: msg }); };
  try {
    if (b.invite) {
      const u = await team.acceptInvite(String(b.invite), String(b.password || ''));
      res.setHeader('Set-Cookie', team.issue(res, u));
      return res.status(200).json({ ok: true, role: 'caller' });
    }
    if (b.email) {
      const u = await team.login(String(b.email), String(b.password || ''));
      if (!u) return fail('Wrong email or password.');
      attempts.delete(key);
      res.setHeader('Set-Cookie', team.issue(res, u));
      return res.status(200).json({ ok: true, role: 'caller' });
    }
  } catch (e) {
    return res.status(/^Invalid/.test(e.message) ? 400 : 500).json({ error: /^Invalid/.test(e.message) ? e.message.replace(/^Invalid:\s*/, '') : 'Could not sign in.' });
  }
  if (!passwordOk(String(b.password || ''))) return fail('Wrong password.');
  attempts.delete(key);
  issue(res);
  return res.status(200).json({ ok: true, role: 'admin' });
};
