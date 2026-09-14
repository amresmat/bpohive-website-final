module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.VERCEL_ENV === 'production') {
    const origin = req.headers?.origin;
    let allowed = false;
    try {
      const hostname = new URL(origin).hostname;
      allowed = hostname === 'bpohive.com' || hostname === 'www.bpohive.com' || hostname === process.env.VERCEL_URL;
    } catch {}
    if (!allowed) return res.status(403).json({ error: 'Origin not allowed.' });
  }
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  const event = {
    type: 'calendly_event_scheduled',
    email: typeof body.email === 'string' ? body.email.slice(0, 200) : '',
    companyName: typeof body.companyName === 'string' ? body.companyName.slice(0, 160) : '',
    calendly: body.calendly || {},
    recordedAt: new Date().toISOString()
  };
  if (process.env.ZAPIER_BOOKING_WEBHOOK_URL) {
    try {
      await fetch(process.env.ZAPIER_BOOKING_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    } catch (error) {
      console.error('Calendly booking webhook failed');
    }
  }
  return res.status(200).json({ accepted: true });
};
