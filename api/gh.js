// Passes the content admin's GitHub requests through the server, so editors only need the
// shared admin password. Only this website's repository can be reached.
const { signedIn } = require('../lib/admin-auth.cjs');
const { getAuth, renew } = require('../lib/cms-token.cjs');
const { REPO } = require('../lib/cms-oauth.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!signedIn(req)) return res.status(401).json({ message: 'Please sign in to the admin again.' });
  const path = '/' + String(req.query.path || '').replace(/^\/+/, '');
  const allowed = path === '/user' || path === '/repos/' + REPO || path.startsWith('/repos/' + REPO + '/');
  if (!allowed || path.includes('..')) return res.status(403).json({ message: 'Not allowed' });
  let auth = null;
  try { auth = await getAuth(); } catch {}
  if (!auth) return res.status(409).json({ message: 'GitHub is not connected yet.', reconnect: true });
  // Renew a few minutes before the key runs out.
  if (auth.expires && auth.expires - Date.now() < 300000) { try { auth = (await renew(auth)) || auth; } catch {} }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) if (k !== 'path') [].concat(v).forEach(x => qs.append(k, x));
  const url = 'https://api.github.com' + path + (qs.toString() ? '?' + qs : '');
  const body = !['GET', 'HEAD'].includes(req.method) && req.body != null ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
  const call = token => fetch(url, {
    method: req.method,
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: req.headers.accept || 'application/vnd.github+json', 'User-Agent': 'BPO-Hive-CMS', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
    body,
    signal: AbortSignal.timeout(25000)
  });
  try {
    let r = await call(auth.access);
    if (r.status === 401) {
      // The key was rejected: renew once and retry. If that fails, the connection must be redone,
      // which is reported as 409 so the admin shows "Connect GitHub" instead of signing you out.
      let fresh = null;
      try { fresh = await renew(auth); } catch {}
      if (!fresh) return res.status(409).json({ message: 'The GitHub connection has expired. Connect GitHub again.', reconnect: true });
      r = await call(fresh.access);
      if (r.status === 401) return res.status(409).json({ message: 'The GitHub connection has expired. Connect GitHub again.', reconnect: true });
    }
    ['content-type', 'link', 'etag', 'x-ratelimit-remaining'].forEach(h => { const v = r.headers.get(h); if (v) res.setHeader(h, v); });
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = r.status;
    return res.end(buf);
  } catch (e) {
    return res.status(502).json({ message: 'GitHub could not be reached. Try again.' });
  }
};
