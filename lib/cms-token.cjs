// The GitHub key the content admin uses behind the scenes. It is connected once (by an
// account with access to the repository), kept encrypted in the private database, and only
// ever used on the server. Editors sign in with the shared admin password instead of GitHub.
const crypto = require('node:crypto');
const { pipe, configured } = require('./entries.cjs');
const KEY = 'cms:github-token';

function cipherKey() {
  const s = process.env.CMS_STATE_SECRET || '';
  if (s.length < 32) throw new Error('CMS_STATE_SECRET missing');
  return crypto.createHash('sha256').update('bh-cms-token:' + s).digest();
}

async function saveToken(token) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  await pipe([['SET', KEY, [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.')]]);
}

async function getToken() {
  if (!configured()) return '';
  const [raw] = await pipe([['GET', KEY]]);
  if (!raw) return '';
  const [iv, tag, enc] = raw.split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// The connection is stored as { access, refresh, expires }. GitHub's keys for this kind of
// app expire after about 8 hours, so the server renews them with the refresh key (valid ~6 months).
async function saveAuth(auth) { await saveToken(JSON.stringify(auth)); }

async function getAuth() {
  const raw = await getToken();
  if (!raw) return null;
  try { const a = JSON.parse(raw); if (a && a.access) return a; } catch {}
  return { access: raw };
}

function fromGitHub(t) {
  return { access: t.access_token, refresh: t.refresh_token || '', expires: t.expires_in ? Date.now() + t.expires_in * 1000 : 0 };
}

async function renew(auth) {
  if (!auth || !auth.refresh) return null;
  const { config } = require('./cms-oauth.cjs');
  const cfg = config();
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.id, client_secret: cfg.secret, grant_type: 'refresh_token', refresh_token: auth.refresh }),
    signal: AbortSignal.timeout(15000)
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) return null;
  const next = fromGitHub(t);
  await saveAuth(next);
  return next;
}

module.exports = { saveToken, getToken, saveAuth, getAuth, renew, fromGitHub };
