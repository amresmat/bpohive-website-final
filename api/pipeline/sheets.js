// Receives the Lead Entry Google Sheets from the "BPO Hive Pipeline sync" Apps Script every 15 minutes.
// Each push carries the Google account's signed identity token; only bpohive.com accounts we list are accepted.
const { configured } = require('../../lib/entries.cjs');
const pl = require('../../lib/pipeline.cjs');

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'The database is not connected yet.' });
  let email;
  try { email = await pl.verifyGoogleToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')); }
  catch (e) { return res.status(403).json({ error: 'Not allowed: ' + e.message }); }
  // The script asks which sheets to read (set in Admin -> Pipeline -> Sources), then sends them.
  if (req.method === 'GET') return res.status(200).json({ sheets: (await pl.getSources()).map(s => s.id) });
  try {
    const out = await pl.saveSheets(await body(req), email);
    return res.status(200).json(Object.assign({ ok: true }, out));
  } catch (e) {
    console.error('Pipeline sheets failed:', e.message);
    return res.status(400).json({ error: 'Could not read the sheets.' });
  }
};
