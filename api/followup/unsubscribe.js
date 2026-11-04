// One-click unsubscribe from the follow-up emails.
const { unsubscribe } = require('../../lib/followup.cjs');
const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | BPO Hive</title><style>body{margin:0;background:#f5f9fc;color:#102534;font:17px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}.c{max-width:460px;margin:14vh auto;padding:32px;border:1px solid #dbe8f0;border-radius:12px;background:#fff}h1{margin:0 0 8px;font-size:24px}a{color:#0f7ac4}</style></head><body><div class="c"><h1>${title}</h1><p>${text}</p><p><a href="https://www.bpohive.com/">Back to bpohive.com</a></p></div></body></html>`;
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const t = (req.query && req.query.t) || '';
  let email = '';
  try { email = await unsubscribe(t); } catch (e) { console.error('Unsubscribe failed:', e.message); }
  if (req.method === 'POST') return res.status(email ? 200 : 400).json({ ok: Boolean(email) });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!email) return res.status(400).end(page('Link not valid', 'This unsubscribe link is incomplete. Reply to the email with "unsubscribe" and we will remove you by hand.'));
  return res.status(200).end(page('You are unsubscribed', 'We won\'t send you any more emails about your request. If you ever want to talk, you can reach us at info@bpohive.com.'));
};
