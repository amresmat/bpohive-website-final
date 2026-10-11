// One shared admin password, set as ADMIN_PASSWORD in Vercel > Settings > Environment Variables.
// The sign-in cookie is signed with a key made from that password, so changing the password
// signs everyone out.
const crypto = require('node:crypto');
const NAME = 'bh_admin';
const HOURS = 12;

const secret = () => process.env.ADMIN_PASSWORD || '';
const sign = v => crypto.createHmac('sha256', 'bh-admin:' + secret()).update(v).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function passwordOk(input) {
  if (!secret()) return false;
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(secret()));
}

function issue(res) {
  const exp = String(Date.now() + HOURS * 3600 * 1000);
  res.setHeader('Set-Cookie', `${NAME}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HOURS * 3600}`);
}

function clear(res) {
  res.setHeader('Set-Cookie', `${NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

function signedIn(req) {
  if (!secret()) return false;
  const raw = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(NAME + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(NAME.length + 1).split('.');
  return Boolean(exp && sig && Number(exp) > Date.now() && same(sig, sign(exp)));
}

module.exports = { passwordOk, issue, clear, signedIn };
