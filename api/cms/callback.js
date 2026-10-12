// Finishes the one-time GitHub connection and stores the key encrypted on the server.
const c = require('../../lib/cms-oauth.cjs');
const { saveToken } = require('../../lib/cms-token.cjs');
const pages = require('../../lib/cms-pages.cjs');

module.exports = async (req, res) => {
  c.headers(res);
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('Method not allowed'); }
  res.setHeader('Set-Cookie', c.cookie('', 0));
  try {
    const cfg = c.config();
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(c.COOKIE + '='));
    const saved = c.unseal(raw?.slice(c.COOKIE.length + 1), cfg.stateSecret);
    // The admin cookie is not sent on the redirect back from GitHub, so the admin sign-in is
    // checked through the signed, 10-minute state cookie, which is only issued to a signed-in admin.
    if (saved.admin !== true) throw Error('Not signed in');
    if (!c.equal(saved.state, req.query?.state) || typeof req.query?.code !== 'string' || req.query.code.length > 512) throw Error('Invalid callback');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: cfg.id, client_secret: cfg.secret, code: req.query.code, redirect_uri: c.CALLBACK, code_verifier: saved.verifier }), signal: AbortSignal.timeout(15000) });
    if (!tokenResponse.ok) throw Error('Token exchange failed');
    const token = await tokenResponse.json();
    if (!token.access_token) throw Error('No token');
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'BPO-Hive-CMS' };
    const [u, r] = await Promise.all([fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(15000) }), fetch('https://api.github.com/repos/' + c.REPO, { headers, signal: AbortSignal.timeout(15000) })]);
    if (!u.ok || !r.ok) throw Error('Access denied');
    const user = await u.json(), repo = await r.json();
    const allowed = (process.env.CMS_ALLOWED_USERS || 'amresmat').toLowerCase().split(',').map(s => s.trim());
    if (!allowed.includes(user.login?.toLowerCase()) || !repo.permissions?.push) throw Error('Access denied');
    await saveToken(token.access_token);
    return pages.success(req, res);
  } catch {
    c.popup(res, 'error', { message: 'GitHub connection failed. Please try again.' });
  }
};
