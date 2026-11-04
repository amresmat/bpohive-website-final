// Receives visitor events from /assets/js/insight.js and stores them for the admin Analytics section.
const { configured, ingest } = require('../../lib/insight.cjs');
const recent = new Map();
// Visitors from these countries are not recorded at all (mostly our own team and offshore traffic).
const EXCLUDE = String(process.env.INSIGHT_EXCLUDE_COUNTRIES || 'EG,PK,IN').toUpperCase().split(/[,\s]+/).filter(Boolean);

function allowed(req) {
  if (process.env.VERCEL_ENV !== 'production') return true;
  const origin = req.headers.origin || req.headers.referer || '';
  try { const host = new URL(origin).hostname; return ['bpohive.com', 'www.bpohive.com', process.env.VERCEL_URL].filter(Boolean).includes(host); } catch { return false; }
}
function limited(req) {
  const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (recent.size > 5000) recent.clear();
  const hits = (recent.get(key) || []).filter(t => now - t < 600000);
  hits.push(now); recent.set(key, hits);
  return hits.length > 400;
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 1024 * 1024) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!allowed(req)) return res.status(403).end();
  if (limited(req)) return res.status(429).end();
  if (!configured()) return res.status(204).end();
  if (EXCLUDE.includes(String(req.headers['x-vercel-ip-country'] || '').toUpperCase())) { res.setHeader('X-Insight', 'skip'); return res.status(204).end(); }
  let body;
  try { body = await readBody(req); } catch (e) { return res.status(/large/.test(e.message) ? 413 : 400).end(); }
  if (!body || JSON.stringify(body).length > 1024 * 1024) return res.status(413).end();
  try { await ingest(body, req); } catch (e) { console.error('Insight ingest failed:', e.message); return res.status(400).end(); }
  return res.status(204).end();
};
