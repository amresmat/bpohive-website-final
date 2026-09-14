const CALENDLY_EVENT_URL = 'https://calendly.com/d/43h-5tz-rkf/discovery-call';
const recentRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const budgetLabels = {
  under_3000: 'Not ready to invest $3,000 yet',
  '3000_4999': '$3,000–$4,999',
  '5000_9999': '$5,000–$9,999',
  '10000_plus': '$10,000+'
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function requiredText(value, maxLength = 800) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requestAllowed(req) {
  if (process.env.VERCEL_ENV !== 'production') return true;
  const origin = req.headers?.origin;
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'bpohive.com' || hostname === 'www.bpohive.com' || hostname === process.env.VERCEL_URL;
  } catch {
    return false;
  }
}

function rateLimited(req) {
  const forwarded = requiredText(req.headers?.['x-forwarded-for'], 200).split(',')[0].trim();
  const key = forwarded || requiredText(req.socket?.remoteAddress, 200) || 'unknown';
  const now = Date.now();
  const existing = recentRequests.get(key) || [];
  const active = existing.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  active.push(now);
  recentRequests.set(key, active);
  return active.length > RATE_LIMIT_MAX;
}

function normalizeUrl(value) {
  const candidate = requiredText(value, 300);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function forecastFor(averageSale) {
  const ranges = {
    'Under $5,000': '20–30',
    '$5,000–$9,999': '15–22',
    '$10,000–$24,999': '8–15',
    '$25,000–$49,999': '5–8',
    '$50,000+': '5–8'
  };
  return { touchpoints: 10000, meetingRange: ranges[averageSale] || '10–15' };
}

function calendlyLink(lead, budgetLabel) {
  const params = new URLSearchParams({
    utm_source: 'bpohive.com',
    utm_medium: 'website',
    utm_campaign: 'outbound_assessment',
    name: `${lead.firstName} ${lead.lastName}`.trim(),
    email: lead.email,
    a1: lead.companyName,
    a2: lead.website,
    a3: lead.jobTitle,
    a4: lead.phone,
    a5: lead.offer,
    a6: lead.targetMarket,
    a7: lead.averageSale,
    a8: lead.service,
    a9: budgetLabel,
    a10: lead.timeline
  });
  return `${CALENDLY_EVENT_URL}?${params.toString()}`;
}

function qualifiedEmail(lead, forecast, bookingUrl) {
  return {
    subject: `Your BPO Hive outbound plan for ${lead.companyName.replace(/[\r\n]+/g, ' ')}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#102534;line-height:1.6">
        <h1 style="font-size:28px;color:#0d1d2b">Your outbound starting plan</h1>
        <p>Hi ${escapeHtml(lead.firstName)},</p>
        <p>Thanks for completing the BPO Hive outbound assessment. Based on what you shared, <strong>${escapeHtml(lead.companyName)}</strong> meets the starting criteria for a managed outbound campaign.</p>
        <div style="padding:18px;border-radius:12px;background:#f1f9ff">
          <strong>Your recommended starting point</strong>
          <ul>
            <li>Target market: ${escapeHtml(lead.targetMarket)}</li>
            <li>Average revenue per sale: ${escapeHtml(lead.averageSale)}</li>
            <li>Recommended campaign: 30-day Outbound Validation Sprint</li>
            <li>Starting investment: $3,000</li>
            <li>Channels: phone, email, and LinkedIn</li>
            <li>Directional meeting range: ${escapeHtml(forecast.meetingRange)}</li>
          </ul>
        </div>
        <p>These numbers are planning estimates—not guarantees. Before launching, we’ll validate your audience size, offer, prospect data, and qualification criteria.</p>
        <p>The next step is a short strategy call. We’ll turn this initial forecast into a practical campaign plan for your business.</p>
        <p style="margin:28px 0"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:14px 20px;border-radius:10px;color:#07131d;background:#68bfff;font-weight:bold;text-decoration:none">Book My Strategy Call</a></p>
        <p>Your information will already be filled in. You’ll only need to choose a time.</p>
        <p>Best,<br>The BPO Hive Team</p>
      </div>`
  };
}

function nurtureEmail(lead) {
  return {
    subject: `Your outbound readiness plan for ${lead.companyName.replace(/[\r\n]+/g, ' ')}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#102534;line-height:1.6">
        <h1 style="font-size:28px;color:#0d1d2b">Your outbound readiness plan</h1>
        <p>Hi ${escapeHtml(lead.firstName)},</p>
        <p>Thanks for completing the BPO Hive outbound assessment.</p>
        <p>Based on your current investment level, a fully managed campaign probably is not the right next step yet—and we do not want you spending before the foundations are ready.</p>
        <ol>
          <li><strong>Define one narrow buyer profile</strong> instead of targeting everyone.</li>
          <li><strong>Build a starter list of 100 companies</strong> that closely match that profile.</li>
          <li><strong>Test two messaging angles</strong> through email and LinkedIn before increasing volume.</li>
        </ol>
        <p>Once you are ready to invest at least $3,000 in a managed Validation Sprint, reply to this email with <strong>READY</strong>.</p>
        <p>Best,<br>The BPO Hive Team</p>
      </div>`
  };
}

function ownerNotificationEmail(lead, qualified, budgetLabel, bookingUrl) {
  const rows = [
    ['Name', `${lead.firstName} ${lead.lastName}`.trim()],
    ['Work email', lead.email],
    ['Phone number', lead.phone],
    ['Job title', lead.jobTitle],
    ['Company', lead.companyName],
    ['Company website', lead.website],
    ['Product/service', lead.offer],
    ['Target market', lead.targetMarket],
    ['Average revenue per sale', lead.averageSale],
    ['Service needed', lead.service],
    ['Initial campaign budget', budgetLabel],
    ['Desired launch timeline', lead.timeline]
  ];
  const safeCompanyName = lead.companyName.replace(/[\r\n]+/g, ' ');
  return {
    subject: `${qualified ? 'Qualified' : 'Nurture'} assessment: ${safeCompanyName} — ${budgetLabel}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#102534;line-height:1.6">
        <h1 style="font-size:26px;color:#0d1d2b">${qualified ? 'Qualified' : 'Nurture'} BPO Hive assessment</h1>
        <p><strong>Status:</strong> ${qualified ? 'Qualified for a $3,000+ Validation Sprint' : 'Readiness-plan nurture'}</p>
        <table style="width:100%;border-collapse:collapse">
          ${rows.map(([label, value]) => `<tr><th style="padding:9px;border:1px solid #dbe6ec;text-align:left;background:#f5f9fb">${escapeHtml(label)}</th><td style="padding:9px;border:1px solid #dbe6ec">${escapeHtml(value)}</td></tr>`).join('')}
        </table>
        ${bookingUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(bookingUrl)}">Open the prospect's prefilled Calendly link</a></p>` : ''}
      </div>`
  };
}

async function sendZapierEvent(event) {
  if (!process.env.ZAPIER_WEBHOOK_URL) return { configured: false, delivered: false };
  try {
    const response = await fetch(process.env.ZAPIER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Zapier returned ${response.status}`);
    return { configured: true, delivered: true };
  } catch (error) {
    console.error('Zapier assessment workflow failed');
    return { configured: true, delivered: false };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requestAllowed(req)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  if (JSON.stringify(body).length > 20000) return res.status(413).json({ error: 'Request is too large.' });
  if (body.companyFax) return res.status(200).json({ accepted: true });

  const lead = {
    firstName: requiredText(body.firstName, 80), lastName: requiredText(body.lastName, 80),
    email: requiredText(body.email, 200).toLowerCase(), phone: requiredText(body.phone, 60),
    jobTitle: requiredText(body.jobTitle, 120), companyName: requiredText(body.companyName, 160),
    website: normalizeUrl(body.website), offer: requiredText(body.offer), targetMarket: requiredText(body.targetMarket),
    averageSale: requiredText(body.averageSale, 80), service: requiredText(body.service, 120),
    budget: requiredText(body.budget, 40), timeline: requiredText(body.timeline, 80),
    pageUrl: requiredText(body.pageUrl, 500), referrer: requiredText(body.referrer, 500), submittedAt: new Date().toISOString()
  };

  const required = ['firstName','lastName','email','phone','jobTitle','companyName','website','offer','targetMarket','averageSale','service','budget','timeline'];
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email);
  if (!emailOk || required.some(key => !lead[key]) || !budgetLabels[lead.budget]) return res.status(400).json({ error: 'Please complete all required fields.' });

  const qualified = lead.budget !== 'under_3000';
  const budgetLabel = budgetLabels[lead.budget];
  const forecast = forecastFor(lead.averageSale);
  const bookingUrl = qualified ? calendlyLink(lead, budgetLabel) : '';
  const prospectEmail = qualified ? qualifiedEmail(lead, forecast, bookingUrl) : nurtureEmail(lead);
  const ownerEmailAddress = process.env.LEAD_NOTIFICATION_EMAIL || 'info@bpohive.com';
  const ownerEmail = ownerNotificationEmail(lead, qualified, budgetLabel, bookingUrl);
  const event = {
    type: 'outbound_assessment_submitted',
    source: 'BPO Hive outbound assessment',
    submitted_at: lead.submittedAt,
    qualification_status: qualified ? 'Qualified' : 'Readiness plan',
    qualified,
    first_name: lead.firstName,
    last_name: lead.lastName,
    work_email: lead.email,
    phone_number: lead.phone,
    job_title: lead.jobTitle,
    company_name: lead.companyName,
    company_website: lead.website,
    product_or_service: lead.offer,
    target_market: lead.targetMarket,
    average_sale_value: lead.averageSale,
    services_needed: lead.service,
    initial_campaign_budget: budgetLabel,
    desired_launch_timeline: lead.timeline,
    forecast_touchpoints: forecast.touchpoints,
    forecast_range: forecast.meetingRange,
    prefilled_calendly_link: bookingUrl,
    page_url: lead.pageUrl,
    referrer: lead.referrer,
    prospect_email_to: lead.email,
    prospect_email_subject: prospectEmail.subject,
    prospect_email_html: prospectEmail.html,
    prospect_email_reply_to: ownerEmailAddress,
    owner_email_to: ownerEmailAddress,
    owner_email_subject: ownerEmail.subject,
    owner_email_html: ownerEmail.html,
    owner_email_reply_to: lead.email
  };
  const zapier = await sendZapierEvent(event);
  const emailConfigured = zapier.delivered && process.env.ZAPIER_SENDS_EMAIL === 'true';

  return res.status(200).json({
    accepted: true,
    qualified,
    budgetLabel,
    forecast,
    bookingUrl,
    emailConfigured,
    leadLoggingConfigured: zapier.delivered,
    workflowDelivered: zapier.delivered
  });
};
