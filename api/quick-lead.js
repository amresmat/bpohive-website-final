// Short "Build my campaign" form. Sends the lead through the same Zapier webhook as the
// outbound assessment, with its own event type so the Zap can tell the two apart.
const CALENDLY = 'https://calendly.com/d/43h-5tz-rkf/discovery-call';
const BUDGETS = { '4000_6000': '$4,000–$6,000', '6000_10000': '$6,000–$10,000', '10000_plus': '$10,000+', smaller_start: "I'd like a smaller first step" };
const PLANS = { validation: 'Validation Sprint', growth: 'Growth', enterprise: 'Enterprise' };
const recent = new Map();
const { saveEntry } = require('../lib/entries.cjs');

const text = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function allowed(req) {
  if (process.env.VERCEL_ENV !== 'production') return true;
  try {
    const host = new URL(req.headers.origin).hostname;
    return ['bpohive.com', 'www.bpohive.com', process.env.VERCEL_URL].filter(Boolean).includes(host);
  } catch { return false; }
}

function limited(req) {
  const key = text(req.headers?.['x-forwarded-for'], 200).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (recent.get(key) || []).filter(t => now - t < 600000);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > 6;
}

async function deliver(event) {
  if (!process.env.ZAPIER_WEBHOOK_URL) {
    console.error('QUICK LEAD NOT DELIVERED (ZAPIER_WEBHOOK_URL missing):', JSON.stringify(event.summary));
    return false;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(process.env.ZAPIER_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event), signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error('Zapier ' + r.status);
      return true;
    } catch {
      if (attempt === 2) { console.error('QUICK LEAD NOT DELIVERED (Zapier failed twice):', JSON.stringify(event.summary)); return false; }
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowed(req)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (limited(req)) return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });

  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Invalid request.' }); }
  if (JSON.stringify(b).length > 8000) return res.status(413).json({ error: 'Request is too large.' });
  if (b.companyFax) return res.status(200).json({ accepted: true });

  const name = text(b.name, 120).replace(/\s+/g, ' ');
  const parts = name.split(' ');
  const website = text(b.website, 200).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  const lead = {
    name, firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email: text(b.email, 200).toLowerCase(),
    website, company: text(b.company, 160),
    plan: text(b.plan, 20), target: text(b.target, 300), budget: text(b.budget, 20), phone: text(b.phone, 60),
    pageUrl: text(b.pageUrl, 500), referrer: text(b.referrer, 500), cta: text(b.cta, 60), submittedAt: new Date().toISOString()
  };
  const missing = ['name', 'email', 'company', 'website', 'phone', 'plan', 'target', 'budget'].some(k => !lead[k]);
  if (missing || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(lead.website)
    || !BUDGETS[lead.budget] || !PLANS[lead.plan]) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }

  const budgetLabel = BUDGETS[lead.budget];
  // Everyone gets the calendar, whatever budget they pick.
  const qualified = true;
  const bookingUrl = CALENDLY + '?' + new URLSearchParams({
    // aN = question N on the Calendly "BPO Hive Discovery Call" booking form.
    name: lead.name, email: lead.email, a1: lead.company, a2: lead.website, a3: PLANS[lead.plan],
    a4: lead.phone, a6: lead.target, a9: budgetLabel,
    utm_source: 'bpohive.com', utm_medium: 'website', utm_campaign: 'build_my_campaign'
  });
  const owner = process.env.LEAD_NOTIFICATION_EMAIL || 'info@bpohive.com';
  const rows = [['Name', lead.name], ['Work email', lead.email], ['Company', lead.company], ['Website', lead.website], ['Campaign size', PLANS[lead.plan]],
    ['Wants meetings with', lead.target], ['Monthly budget', budgetLabel], ['Phone', lead.phone],
    ['Button clicked', lead.cta], ['Page', lead.pageUrl]];
  const table = rows.map(([k, v]) => `<tr><th style="padding:8px;border:1px solid #dbe6ec;text-align:left;background:#f5f9fb">${esc(k)}</th><td style="padding:8px;border:1px solid #dbe6ec">${esc(v)}</td></tr>`).join('');

  const event = {
    type: 'build_my_campaign_submitted', source: 'BPO Hive build my campaign form', submitted_at: lead.submittedAt,
    qualified, qualification_status: qualified ? 'Qualified' : 'Review',
    first_name: lead.firstName, last_name: lead.lastName, work_email: lead.email, phone_number: lead.phone,
    job_title: '', company_name: lead.company, company_size: '', industry: '', company_hq: '',
    company_website: lead.website, campaign_size: PLANS[lead.plan], target_buyers: lead.target, cta_clicked: lead.cta, monthly_budget: budgetLabel, initial_campaign_budget: budgetLabel,
    prefilled_calendly_link: bookingUrl, page_url: lead.pageUrl, referrer: lead.referrer,
    prospect_email_to: lead.email,
    prospect_email_subject: 'We received your BPO Hive request',
    prospect_email_html: `<p>Hi ${esc(lead.firstName)},</p><p>Thanks for reaching out. If you haven't picked a call time yet, <a href="${esc(bookingUrl)}">choose one here</a>.</p><p>BPO Hive</p>`,
    prospect_email_reply_to: owner,
    owner_email_to: owner,
    owner_email_subject: `New Build my campaign lead: ${lead.company} (${budgetLabel})`,
    owner_email_html: `<h2 style="font-family:Arial">New Build my campaign lead</h2><table style="border-collapse:collapse;font-family:Arial;font-size:14px">${table}</table>`,
    owner_email_reply_to: lead.email,
    summary: { name: lead.name, email: lead.email, phone: lead.phone, website: lead.website, plan: PLANS[lead.plan], budget: budgetLabel }
  };
  await saveEntry('Build my campaign', { name: lead.name, email: lead.email, website: lead.website, plan: PLANS[lead.plan], target: lead.target, budget: budgetLabel, phone: lead.phone, button: lead.cta }, { page: lead.pageUrl, referrer: lead.referrer, draftId: text(b.draftId, 40) });
  const delivered = await deliver(event);
  return res.status(200).json({ accepted: true, qualified, bookingUrl, delivered });
};
