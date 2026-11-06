// Pipeline-only team accounts. The admin adds a person (name, email and the Agent Name(s) they use in
// the Lead Entry sheets) and gets an invite link to send them. The person opens it and picks their own
// password. They can then sign in to bpohive.com/admin and only see the Pipeline, filtered to their
// own leads and appointments. Removing them (or making a new invite) signs them out everywhere.
const crypto = require('node:crypto');
const { pipe } = require('./entries.cjs');

const COOKIE = 'bh_team';
const HOURS = 12;
const INVITE_DAYS = 7;
let _pipe = pipe;
const P = c => _pipe(c);
const clean = (v, n = 200) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const emailOf = v => { const e = clean(v, 200).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; };
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const secret = () => 'bh-team:' + (process.env.ADMIN_PASSWORD || '');
const sign = v => crypto.createHmac('sha256', secret()).update(v).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function all() {
  const [raw] = await P([['HGETALL', 'team:users']]);
  const out = [];
  for (let i = 0; i < (raw || []).length; i += 2) { const u = parse(raw[i + 1]); if (u) out.push(u); }
  return out;
}
const save = u => P([['HSET', 'team:users', u.id, JSON.stringify(u)]]);
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, agents: u.agents, role: u.role, status: u.pw ? 'active' : (u.inviteExp > Date.now() ? 'invited' : 'invite expired'), inviteExp: u.inviteExp || 0, lastLogin: u.lastLogin || 0, created: u.created });
const agentsOf = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => clean(x, 60)).filter(Boolean).slice(0, 10);

function newInvite(u) {
  const token = crypto.randomBytes(24).toString('base64url');
  u.invite = sha(token); u.inviteExp = Date.now() + INVITE_DAYS * 864e5;
  return token;
}

async function addUser({ name, email, agents }) {
  const e = emailOf(email); if (!e) throw new Error('Invalid: enter a valid email');
  if (!clean(name)) throw new Error('Invalid: enter a name');
  const list = await all();
  if (list.some(u => u.email === e)) throw new Error('Invalid: this email already has access');
  const u = { id: crypto.randomBytes(8).toString('hex'), name: clean(name, 80), email: e, agents: agentsOf(agents), role: 'caller', created: Date.now(), ver: 1 };
  if (!u.agents.length) u.agents = [u.name.split(' ')[0]];
  const token = newInvite(u);
  await save(u);
  return { user: publicUser(u), token };
}
async function updateUser(id, { name, agents }) {
  const u = (await all()).find(x => x.id === id); if (!u) throw new Error('Invalid: user not found');
  if (name !== undefined && clean(name)) u.name = clean(name, 80);
  if (agents !== undefined) u.agents = agentsOf(agents);
  await save(u);
  return publicUser(u);
}
// A fresh invite link: the old password stops working and they are signed out.
async function reinvite(id) {
  const u = (await all()).find(x => x.id === id); if (!u) throw new Error('Invalid: user not found');
  delete u.pw; delete u.salt; u.ver = (u.ver || 1) + 1;
  const token = newInvite(u);
  await save(u);
  return { user: publicUser(u), token };
}
async function removeUser(id) { const [n] = await P([['HDEL', 'team:users', String(id)]]); return Boolean(n); }

function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function checkPw(pw) { if (String(pw || '').length < 8) throw new Error('Invalid: use at least 8 characters'); }

async function acceptInvite(token, password) {
  checkPw(password);
  const h = sha(String(token || ''));
  const u = (await all()).find(x => x.invite && same(x.invite, h));
  if (!u || !(u.inviteExp > Date.now())) throw new Error('Invalid: this invite link has expired or was replaced. Ask for a new one.');
  u.salt = crypto.randomBytes(16).toString('hex'); u.pw = hashPw(password, u.salt);
  delete u.invite; delete u.inviteExp; u.ver = (u.ver || 1) + 1; u.lastLogin = Date.now();
  await save(u);
  return u;
}
async function inviteInfo(token) {
  const h = sha(String(token || ''));
  const u = (await all()).find(x => x.invite && same(x.invite, h));
  return u && u.inviteExp > Date.now() ? { name: u.name, email: u.email } : null;
}
async function login(email, password) {
  const e = emailOf(email);
  const u = (await all()).find(x => x.email === e);
  if (!u || !u.pw) { hashPw(password || 'x', 'dummy-salt'); return null; }
  if (!same(hashPw(password, u.salt), u.pw)) return null;
  u.lastLogin = Date.now(); await save(u);
  return u;
}

function issue(res, u) {
  const exp = String(Date.now() + HOURS * 3600e3);
  const v = `${u.id}.${u.ver || 1}.${exp}`;
  return `${COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HOURS * 3600}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
async function userFrom(req) {
  if (!process.env.ADMIN_PASSWORD) return null;
  const raw = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const parts = raw.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  if (!(Number(exp) > Date.now()) || !same(sig, sign(`${id}.${ver}.${exp}`))) return null;
  const [rawU] = await P([['HGET', 'team:users', id]]);
  const u = parse(rawU);
  if (!u || !u.pw || String(u.ver || 1) !== ver) return null;
  return u;
}

module.exports = { addUser, updateUser, reinvite, removeUser, all: async () => (await all()).map(publicUser), acceptInvite, inviteInfo, login, issue, clearCookie, userFrom, _setPipe: f => { _pipe = f; } };
