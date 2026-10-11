const { passwordOk, issue, clear } = require('../../lib/admin-auth.cjs');
const attempts = new Map();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'DELETE') { clear(res); return res.status(200).json({ ok: true }); }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'The admin password has not been set up yet.' });
  const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const tries = (attempts.get(key) || []).filter(t => now - t < 900000);
  if (tries.length >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return res.status(400).json({ error: 'Invalid' }); }
  if (!passwordOk(String(b.password || ''))) {
    tries.push(now); attempts.set(key, tries);
    await new Promise(r => setTimeout(r, 600));
    return res.status(401).json({ error: 'Wrong password.' });
  }
  attempts.delete(key);
  issue(res);
  return res.status(200).json({ ok: true });
};
