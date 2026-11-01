// Sends qualified real estate recruiting leads straight from the server to Meta (Conversions API),
// so Facebook still counts them when the browser pixel is blocked (iPhones, ad blockers, in-app
// browsers). The browser pixel sends the same Lead with the same event id, and Meta keeps only one.
// Needs META_CAPI_TOKEN in Vercel (Events Manager > dataset > Settings > Conversions API > Generate access token).
const crypto = require('node:crypto');

const PIXEL_ID = '1492963711498633';
const GRAPH = 'https://graph.facebook.com/v21.0/' + PIXEL_ID + '/events';

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const norm = v => (v == null ? '' : String(v).trim().toLowerCase());

// A US-style 10-digit number gets the US country code, as Meta expects digits with country code.
function phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '1' + d;
  return d.length >= 7 ? d : '';
}

// Facebook click id from the landing page link, in the "fb.1.<time>.<fbclid>" format Meta uses.
function fbcFrom(pageUrl, ms) {
  try {
    const id = new URL(pageUrl).searchParams.get('fbclid');
    return id ? `fb.1.${ms}.${id}` : '';
  } catch { return ''; }
}

const configured = () => Boolean(process.env.META_CAPI_TOKEN);

// lead: { email, phone, firstName, lastName, pageUrl, eventId, eventTimeMs, fbp, fbc, ip, userAgent }
async function sendLead(lead) {
  if (!configured()) return { sent: false, reason: 'META_CAPI_TOKEN missing' };
  const ms = lead.eventTimeMs || Date.now();
  const user = {};
  const em = norm(lead.email); if (em) user.em = [sha(em)];
  const ph = phoneDigits(lead.phone); if (ph) user.ph = [sha(ph)];
  const fn = norm(lead.firstName); if (fn) user.fn = [sha(fn)];
  const ln = norm(lead.lastName); if (ln) user.ln = [sha(ln)];
  user.country = [sha('us')];
  const fbc = lead.fbc || fbcFrom(lead.pageUrl, ms); if (fbc) user.fbc = fbc;
  if (lead.fbp) user.fbp = lead.fbp;
  if (lead.ip) user.client_ip_address = lead.ip;
  if (lead.userAgent) user.client_user_agent = lead.userAgent;

  const body = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(ms / 1000),
      event_id: lead.eventId,
      action_source: 'website',
      event_source_url: lead.pageUrl || 'https://www.bpohive.com/real-estate-recruiting',
      user_data: user,
      custom_data: { content_name: 'Real estate recruiting', value: 799, currency: 'USD' }
    }]
  };
  try {
    const r = await fetch(GRAPH + '?access_token=' + encodeURIComponent(process.env.META_CAPI_TOKEN), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(6000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('Meta CAPI error:', r.status, JSON.stringify(j.error || j).slice(0, 300)); return { sent: false, reason: 'Meta ' + r.status }; }
    return { sent: true, received: j.events_received };
  } catch (e) {
    console.error('Meta CAPI failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { configured, sendLead };
