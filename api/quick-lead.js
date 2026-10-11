// Short "Build my campaign" form. Sends the lead through the same Zapier webhook as the
// outbound assessment, with its own event type so the Zap can tell the two apart.
const CALENDLY = 'https://calendly.com/d/43h-5tz-rkf/discovery-call';
const BUDGETS = { '5000_plus': '$5,000+', '0_5000': '$0 to $5,000', unsure: 'Unsure' };
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1,000', '1,000+'];
const recent = new Map();

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

  const lead = {
    firstName: text(b.firstName, 80), lastName: text(b.lastName, 80), email: text(b.email, 200).toLowerCase(),
    budget: text(b.budget, 20), jobTitle: text(b.jobTitle, 120), company: text(b.company, 160),
    size: text(b.size, 20), phone: text(b.phone, 60), industry: text(b.industry, 120), hq: text(b.hq, 80),
    pageUrl: text(b.pageUrl, 500), referrer: text(b.referrer, 500), submittedAt: new Date().toISOString()
  };
  const missing = ['firstName', 'lastName', 'email', 'budget', 'jobTitle', 'company', 'size', 'phone', 'industry', 'hq'].some(k => !lead[k]);
  if (missing || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !BUDGETS[lead.budget] || !SIZES.includes(lead.size)) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }

  const budgetLabel = BUDGETS[lead.budget];
  const qualified = lead.budget === '5000_plus';
  const bookingUrl = qualified ? CALENDLY + '?' + new URLSearchParams({
    name: `${lead.firstName} ${lead.lastName}`, email: lead.email, a1: lead.company, a3: lead.jobTitle,
    utm_source: 'bpohive.com', utm_medium: 'website', utm_campaign: 'build_my_campaign'
  }) : '';
  const owner = process.env.LEAD_NOTIFICATION_EMAIL || 'info@bpohive.com';
  const rows = [['Name', `${lead.firstName} ${lead.lastName}`], ['Business email', lead.email], ['Monthly budget', budgetLabel],
    ['Job title', lead.jobTitle], ['Company', lead.company], ['Company size', lead.size], ['Phone', lead.phone],
    ['Industry', lead.industry], ['HQ', lead.hq], ['Page', lead.pageUrl]];
  const table = rows.map(([k, v]) => `<tr><th style="padding:8px;border:1px solid #dbe6ec;text-align:left;background:#f5f9fb">${esc(k)}</th><td style="padding:8px;border:1px solid #dbe6ec">${esc(v)}</td></tr>`).join('');

  const event = {
    type: 'build_my_campaign_submitted', source: 'BPO Hive build my campaign form', submitted_at: lead.submittedAt,
    qualified, qualification_status: qualified ? 'Qualified' : 'Review',
    first_name: lead.firstName, last_name: lead.lastName, work_email: lead.email, phone_number: lead.phone,
    job_title: lead.jobTitle, company_name: lead.company, company_size: lead.size, industry: lead.industry,
    company_hq: lead.hq, monthly_budget: budgetLabel, initial_campaign_budget: budgetLabel,
    prefilled_calendly_link: bookingUrl, page_url: lead.pageUrl, referrer: lead.referrer,
    prospect_email_to: lead.email,
    prospect_email_subject: 'We received your BPO Hive request',
    prospect_email_html: `<p>Hi ${esc(lead.firstName)},</p><p>Thanks for reaching out. Our team will review your details and reply to this email within one business day.</p>${bookingUrl ? `<p>If you'd like to talk sooner, <a href="${esc(bookingUrl)}">choose a call time here</a>.</p>` : ''}<p>BPO Hive</p>`,
    prospect_email_reply_to: owner,
    owner_email_to: owner,
    owner_email_subject: `New Build my campaign lead: ${lead.company} (${budgetLabel})`,
    owner_email_html: `<h2 style="font-family:Arial">New Build my campaign lead</h2><table style="border-collapse:collapse;font-family:Arial;font-size:14px">${table}</table>`,
    owner_email_reply_to: lead.email,
    summary: { name: `${lead.firstName} ${lead.lastName}`, email: lead.email, phone: lead.phone, company: lead.company, budget: budgetLabel, hq: lead.hq }
  };
  const delivered = await deliver(event);
  return res.status(200).json({ accepted: true, qualified, bookingUrl, delivered });
};
