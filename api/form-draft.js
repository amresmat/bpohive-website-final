// Records unfinished forms as the visitor types, so they show under "Abandoned forms"
// in the admin entries page. Finished submissions are recorded by each form's own endpoint.
const { saveDraft } = require('../lib/entries.cjs');
const recent = new Map();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.VERCEL_ENV === 'production') {
    let host = '';
    try { host = new URL(req.headers.origin).hostname; } catch {}
    if (!['bpohive.com', 'www.bpohive.com', process.env.VERCEL_URL].filter(Boolean).includes(host)) return res.status(403).json({ error: 'Origin not allowed' });
  }
  const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hits = (recent.get(key) || []).filter(t => now - t < 600000);
  hits.push(now); recent.set(key, hits);
  if (hits.length > 120) return res.status(429).json({ error: 'Too many requests' });

  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return res.status(400).json({ error: 'Invalid' }); }
  if (JSON.stringify(b).length > 12000) return res.status(413).json({ error: 'Too large' });
  if (!/^[a-z0-9]{12,40}$/i.test(String(b.id || '')) || !b.fields || typeof b.fields !== 'object') return res.status(400).json({ error: 'Invalid' });
  try {
    const saved = await saveDraft(String(b.id), b.form, b.fields, { page: b.page, referrer: b.referrer });
    return res.status(200).json({ ok: true, saved });
  } catch (e) {
    console.error('Draft not saved:', e.message);
    return res.status(500).json({ error: 'Draft not saved' });
  }
};
