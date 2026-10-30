// Real estate recruiting ad page (/real-estate-recruiting). Step-by-step qualifier for broker-owners.
// Sends the lead through the same Zapier webhook and event type as the "Build my campaign"
// form, so the existing Zap emails the team and the prospect without any Zap changes.
const CALENDLY = 'https://calendly.com/d/43h-5tz-rkf/discovery-call';
const AGENTS = { '1_10': '1–10 agents', '11_50': '11–50 agents', '51_200': '51–200 agents', '200_plus': '200+ agents' };
const ROLES = { owner: 'Broker-owner', managing: 'Managing or principal broker', team: 'Team leader', agent: 'Agent looking for a brokerage' };
const GOALS = { '1_4': '1–4 in the next 3 months', '5_9': '5–9 in the next 3 months', '10_15': '10–15 in the next 3 months', '16_plus': '16+ in the next 3 months' };
const ONGOING = { ongoing: 'Ongoing, every month', one_time: 'A one-time push', unsure: 'Not sure yet' };
const TIMELINES = { '2_weeks': 'Within 2 weeks', '30_days': 'Within 30 days', '1_3_months': 'In 1–3 months' };
const BUDGETS = { yes: 'Yes, $799/month + $500 setup works', discuss: 'Needs to discuss it', no: 'Not right now' };
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
    console.error('RE RECRUITING LEAD NOT DELIVERED (ZAPIER_WEBHOOK_URL missing):', JSON.stringify(event.summary));
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
      if (attempt === 2) { console.error('RE RECRUITING LEAD NOT DELIVERED (Zapier failed twice):', JSON.stringify(event.summary)); return false; }
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
  if (b.companyFax) return res.status(200).json({ accepted: true, bookingUrl: CALENDLY });

  const name = text(b.name, 120).replace(/\s+/g, ' ');
  const parts = name.split(' ');
  const lead = {
    name, firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email: text(b.email, 200).toLowerCase(),
    company: text(b.company, 160), phone: text(b.phone, 60), market: text(b.market, 160), agents: text(b.agents, 20),
    role: text(b.role, 20), goal: text(b.goal, 20), timeline: text(b.timeline, 20), budget: text(b.budget, 20), ongoing: text(b.ongoing, 20),
    pageUrl: text(b.pageUrl, 500), referrer: text(b.referrer, 500), submittedAt: new Date().toISOString()
  };
  const missing = ['name', 'email', 'company', 'phone', 'market', 'agents', 'role', 'goal', 'timeline', 'budget', 'ongoing'].some(k => !lead[k]);
  if (missing || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !AGENTS[lead.agents] || !ROLES[lead.role]
    || !GOALS[lead.goal] || !TIMELINES[lead.timeline] || !BUDGETS[lead.budget] || !ONGOING[lead.ongoing]) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }

  const agentsLabel = AGENTS[lead.agents];
  // Strong fit only: a decision-maker hiring 10+ agents in the next quarter, $799 already fits the
  // budget, starting within 30 days, and wanting ongoing monthly help. Only these see the calendar
  // and only these fire the Meta Pixel Lead event, so Facebook learns from real buyers.
  const qualified = lead.role !== 'agent' && ['10_15', '16_plus'].includes(lead.goal) && lead.budget === 'yes'
    && ['2_weeks', '30_days'].includes(lead.timeline) && lead.ongoing === 'ongoing';
  const status = qualified ? 'Qualified' : 'Not ready';
  const target = `Real estate agents in ${lead.market} (brokerage size: ${agentsLabel})`;
  const bookingUrl = CALENDLY + '?' + new URLSearchParams({
    // aN = question N on the Calendly "BPO Hive Discovery Call" booking form.
    name: lead.name, email: lead.email, a1: lead.company, a3: 'Real estate recruiting ($799/month)',
    a4: lead.phone, a6: target,
    utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'real_estate_recruiting'
  });
  const owner = process.env.LEAD_NOTIFICATION_EMAIL || 'info@bpohive.com';
  const rows = [['Name', lead.name], ['Work email', lead.email], ['Brokerage', lead.company], ['Phone', lead.phone],
    ['Fit', status], ['Role', ROLES[lead.role]], ['Market', lead.market], ['Brokerage size', agentsLabel],
    ['Agents to hire', GOALS[lead.goal]], ['Wants', ONGOING[lead.ongoing]], ['Start', TIMELINES[lead.timeline]], ['$799 budget', BUDGETS[lead.budget]], ['Offer', 'Real estate recruiting, $799/month'], ['Page', lead.pageUrl]];
  const table = rows.map(([k, v]) => `<tr><th style="padding:8px;border:1px solid #dbe6ec;text-align:left;background:#f5f9fb">${esc(k)}</th><td style="padding:8px;border:1px solid #dbe6ec">${esc(v)}</td></tr>`).join('');

  const event = {
    type: 'build_my_campaign_submitted', source: 'BPO Hive real estate recruiting page', submitted_at: lead.submittedAt,
    qualified, qualification_status: status,
    first_name: lead.firstName, last_name: lead.lastName, work_email: lead.email, phone_number: lead.phone,
    job_title: ROLES[lead.role], company_name: lead.company, company_size: agentsLabel, industry: 'Real estate brokerage', company_hq: lead.market,
    company_website: '', campaign_size: 'Real estate recruiting', target_buyers: target, cta_clicked: 'Real estate recruiting form',
    monthly_budget: BUDGETS[lead.budget], initial_campaign_budget: '$799/month',
    prefilled_calendly_link: bookingUrl, page_url: lead.pageUrl, referrer: lead.referrer,
    prospect_email_to: lead.email,
    prospect_email_subject: 'We received your BPO Hive request',
    prospect_email_html: qualified
      ? `<p>Hi ${esc(lead.firstName)},</p><p>Thanks for reaching out about agent recruiting. If you haven't picked a call time yet, <a href="${esc(bookingUrl)}">choose one here</a>.</p><p>BPO Hive</p>`
      : `<p>Hi ${esc(lead.firstName)},</p><p>Thanks for your interest in agent recruiting. Whenever you're ready to start, <a href="${esc(bookingUrl)}">pick a call time here</a>.</p><p>BPO Hive</p>`,
    prospect_email_reply_to: owner,
    owner_email_to: owner,
    owner_email_subject: `${qualified ? 'New' : 'Not-ready'} real estate recruiting lead: ${lead.company} (${lead.market})`,
    owner_email_html: `<h2 style="font-family:Arial">New real estate recruiting lead</h2><table style="border-collapse:collapse;font-family:Arial;font-size:14px">${table}</table>`,
    owner_email_reply_to: lead.email,
    summary: { name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, market: lead.market, agents: agentsLabel, status }
  };
  await saveEntry('Real estate recruiting', { name: lead.name, email: lead.email, brokerage: lead.company, phone: lead.phone, market: lead.market, agents: agentsLabel, role: ROLES[lead.role], goal: GOALS[lead.goal], timeline: TIMELINES[lead.timeline], budget: BUDGETS[lead.budget], ongoing: ONGOING[lead.ongoing], status }, { page: lead.pageUrl, referrer: lead.referrer });
  const delivered = await deliver(event);
  return res.status(200).json({ accepted: true, qualified, bookingUrl, delivered });
};
