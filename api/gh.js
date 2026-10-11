// Passes the content admin's GitHub requests through the server, so editors only need the
// shared admin password. Only this website's repository can be reached.
const { signedIn } = require('../lib/admin-auth.cjs');
const { getToken } = require('../lib/cms-token.cjs');
const { REPO } = require('../lib/cms-oauth.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!signedIn(req)) return res.status(401).json({ message: 'Please sign in to the admin again.' });
  const path = '/' + String(req.query.path || '').replace(/^\/+/, '');
  const allowed = path === '/user' || path === '/repos/' + REPO || path.startsWith('/repos/' + REPO + '/');
  if (!allowed || path.includes('..')) return res.status(403).json({ message: 'Not allowed' });
  let token;
  try { token = await getToken(); } catch { token = ''; }
  if (!token) return res.status(503).json({ message: 'GitHub is not connected yet. Open /api/cms/auth to connect it once.' });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) if (k !== 'path') [].concat(v).forEach(x => qs.append(k, x));
  const url = 'https://api.github.com' + path + (qs.toString() ? '?' + qs : '');
  const init = {
    method: req.method,
    headers: { Authorization: 'Bearer ' + token, Accept: req.headers.accept || 'application/vnd.github+json', 'User-Agent': 'BPO-Hive-CMS', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(25000)
  };
  if (!['GET', 'HEAD'].includes(req.method) && req.body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  try {
    const r = await fetch(url, init);
    ['content-type', 'link', 'etag', 'x-ratelimit-remaining'].forEach(h => { const v = r.headers.get(h); if (v) res.setHeader(h, v); });
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = r.status;
    return res.end(buf);
  } catch (e) {
    return res.status(502).json({ message: 'GitHub could not be reached. Try again.' });
  }
};
