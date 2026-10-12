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

module.exports = { saveToken, getToken };
