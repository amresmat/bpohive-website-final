// Content admin sign-in. Editors use the shared admin password (ADMIN_PASSWORD).
// GitHub is connected once behind the scenes; see lib/cms-token.cjs.
const crypto = require('node:crypto');
const c = require('../../lib/cms-oauth.cjs');
const { signedIn } = require('../../lib/admin-auth.cjs');
const { getToken } = require('../../lib/cms-token.cjs');
const pages = require('../../lib/cms-pages.cjs');

function githubRedirect(res) {
  const cfg = c.config();
  const state = c.random(), verifier = c.random();
  res.setHeader('Set-Cookie', c.cookie(c.seal({ state, verifier, admin: true, at: Date.now() }, cfg.stateSecret)));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: cfg.id, redirect_uri: c.CALLBACK, state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', allow_signup: 'false' });
  res.statusCode = 302;
  res.setHeader('Location', url.href);
  res.end();
}

module.exports = async (req, res) => {
  c.headers(res);
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('Method not allowed'); }
  if (req.query?.provider && req.query.provider !== 'github') { res.statusCode = 400; return res.end('Unsupported provider'); }
  if (!signedIn(req)) return pages.login(res);
  if (req.query?.connect === '1') {
    try { return githubRedirect(res); } catch { res.statusCode = 503; return res.end('GitHub connection is not configured.'); }
  }
  let token = '';
  try { token = await getToken(); } catch {}
  if (!token) return pages.connect(res);
  return pages.success(req, res);
};
