// Follow-up emails for people who typed their email into a form on bpohive.com but never sent it.
// Email 1 goes about an hour after they stopped typing; email 2 three days later if they still
// haven't sent a form. Nobody gets more than two, anyone can unsubscribe, and Canadians are only
// emailed if they ticked the marketing box. Sent through Brevo from success@bpohive.com.
//
// Turned on by two settings in Vercel > Settings > Environment Variables:
//   BREVO_API_KEY      the Brevo API key (Brevo > SMTP & API > API keys)
//   FOLLOWUP_ENABLED   set to 1 to actually send. Anything else = preview only.
const crypto = require('node:crypto');
const { pipe, configured, listEntries } = require('./entries.cjs');

const SENDER = { name: process.env.FOLLOWUP_FROM_NAME || 'BPO Hive Client Success', email: process.env.FOLLOWUP_FROM || 'success@bpohive.com' };
const REPLY_TO = process.env.FOLLOWUP_REPLY_TO || SENDER.email;
const SITE = 'https://www.bpohive.com';
const FIRST_AFTER = 60 * 60 * 1000;          // 1 hour after they stopped typing
const SECOND_AFTER = 3 * 86400 * 1000;       // 3 days after the first email
const LOOK_BACK = 14 * 86400 * 1000;         // only drafts from the last 14 days
const PER_RUN = 25;                          // safety cap per run
const SKIP_PAGES = /careers|real-estate-recruiting|outbound-assessment|admin/i;
const SKIP_EMAILS = /@(bpohive\.com|bpo-outsourcing-services\.com|example\.com|test\.com|mailinator\.com)$|^test[-_.@]/i;

const enabled = () => process.env.FOLLOWUP_ENABLED === '1' && Boolean(process.env.BREVO_API_KEY);
const secret = () => process.env.FOLLOWUP_SECRET || process.env.CMS_STATE_SECRET || process.env.ADMIN_PASSWORD || 'bh-followup';
const sign = v => crypto.createHmac('sha256', 'bh-followup:' + secret()).update(String(v)).digest('base64url').slice(0, 22);
const token = v => Buffer.from(String(v)).toString('base64url') + '.' + sign(v);
function untoken(t) {
  const [a, b] = String(t || '').split('.');
  if (!a || !b) return '';
  let v = ''; try { v = Buffer.from(a, 'base64url').toString(); } catch { return ''; }
  const x = Buffer.from(sign(v)), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y) ? v : '';
}

const clean = (v, n = 200) => (v == null ? '' : String(v).trim().slice(0, n));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emailOf = v => { const e = clean(v, 200).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : ''; };
function firstName(f) {
  const n = clean(f.name || f.fullName || f.firstName || f.first_name || f.fname, 80).split(/\s+/)[0] || '';
  return /^[a-zÀ-ɏ'-]{2,30}$/i.test(n) ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}
function isCanada(d) {
  const f = d.fields || {};
  return d.country === 'CA' || String(f.phoneCountry || '').toUpperCase() === 'CA' || /^canada$/i.test(String(f.targetMarket || f.country || ''));
}
const consented = f => /^(true|yes|on|1)$/i.test(String(f.marketingConsent || f.marketing_consent || ''));

// ----- The two emails ---------------------------------------------------------------
function layout(inner, unsubUrl) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#102534">
${inner}
<p style="margin:28px 0 0;color:#102534">BPO Hive Client Success<br><a href="${SITE}" style="color:#0f7ac4;text-decoration:none">bpohive.com</a> &nbsp;·&nbsp; +1 502 677 3800</p>
<p style="margin:30px 0 0;padding-top:16px;border-top:1px solid #e3ecf2;color:#6b7f8c;font-size:12px;line-height:1.5">You're getting this because this address was entered on bpohive.com. <a href="${unsubUrl}" style="color:#6b7f8c">Unsubscribe</a> and we won't email you again.<br>BPO Hive LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA</p>
</div></body></html>`;
}
const button = (url, label) => `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:13px 22px;border-radius:6px;background:#0f7ac4;color:#ffffff;font-weight:600;text-decoration:none">${esc(label)}</a></p>`;

function build(step, d) {
  const f = d.fields || {}, name = firstName(f), hi = name ? `Hi ${esc(name)},` : 'Hi there,', hiText = name ? `Hi ${name},` : 'Hi there,';
  const company = clean(f.company || f.companyName || f.brokerage, 80);
  const target = clean(f.target, 120);
  const resumeUrl = `${SITE}/?resume=${encodeURIComponent(token(d.id))}&utm_source=followup&utm_medium=email&utm_campaign=abandoned_form_${step}`;
  const unsubUrl = `${SITE}/api/followup/unsubscribe?t=${encodeURIComponent(token(d.email))}`;
  const firstSubject = name ? `${name}, your calendar almost got busier 📅` : 'Your calendar almost got busier 📅';
  const footText = `BPO Hive Client Success\nbpohive.com · +1 502 677 3800\n\nUnsubscribe: ${unsubUrl}\nBPO Hive LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA`;
  const P = t => `<p style="margin:0 0 16px">${t}</p>`;
  let subject, html, text;
  if (step === 1) {
    const about = company ? esc(company) : 'your company', aboutText = company || 'your company';
    subject = firstSubject;
    html = layout(P(hi) +
      P(`You were halfway through telling us about ${about} on bpohive.com, and then life happened. (A meeting, probably. Ironic, we know.)`) +
      P(`Here's the short version of who we are: we fill B2B calendars with qualified sales meetings. We learn your offer, find the decision-makers you actually want to talk to, call and email them, and drop the ones who say yes straight onto your calendar, with notes and the call recording waiting in your portal. You do the closing. We do the chasing.`) +
      P(`Most clients start with a one-month validation sprint, so you see real meetings before you commit to anything bigger.`) +
      button(resumeUrl, 'Finish your request') +
      `<p style="margin:0 0 16px;color:#4f6575;font-size:14px">Takes about 30 seconds. We saved everything you typed, so no starting over.</p>` +
      `<p style="margin:0">Not the right time? Hit reply and tell us what you're working on. A real human reads every reply, no bots behind the curtain.</p>`, unsubUrl);
    text = `${hiText}\n\nYou were halfway through telling us about ${aboutText} on bpohive.com, and then life happened. (A meeting, probably. Ironic, we know.)\n\nHere's the short version of who we are: we fill B2B calendars with qualified sales meetings. We learn your offer, find the decision-makers you actually want to talk to, call and email them, and drop the ones who say yes straight onto your calendar, with notes and the call recording waiting in your portal. You do the closing. We do the chasing.\n\nMost clients start with a one-month validation sprint, so you see real meetings before you commit to anything bigger.\n\nFinish your request (about 30 seconds, everything you typed is saved): ${resumeUrl}\n\nNot the right time? Hit reply and tell us what you're working on. A real human reads every reply, no bots behind the curtain.\n\n${footText}`;
  } else {
    const who = target ? 'with ' + esc(target) : 'with the right decision-makers', whoText = target ? 'with ' + target : 'with the right decision-makers';
    subject = 'Re: ' + firstSubject;
    html = layout(P(hi) +
      P(`Quick nudge, then we'll leave you alone. Promise.`) +
      P(`If more meetings ${who} is still on the wish list, your answers are right where you left them. One minute to finish, then you pick a call time.`) +
      button(resumeUrl, 'Pick up where you left off') +
      `<p style="margin:0">And if it's not a priority right now, no hard feelings. This is the last email you'll get from us about it. (Our calendar will miss yours.)</p>`, unsubUrl);
    text = `${hiText}\n\nQuick nudge, then we'll leave you alone. Promise.\n\nIf more meetings ${whoText} is still on the wish list, your answers are right where you left them. One minute to finish, then you pick a call time:\n${resumeUrl}\n\nAnd if it's not a priority right now, no hard feelings. This is the last email you'll get from us about it. (Our calendar will miss yours.)\n\n${footText}`;
  }
  return { subject, html, text, unsubUrl, resumeUrl };
}

async function send(d, step) {
  const m = build(step, d);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: SENDER, replyTo: { email: REPLY_TO, name: SENDER.name },
      to: [{ email: d.email, name: firstName(d.fields || {}) || undefined }],
      subject: m.subject, htmlContent: m.html, textContent: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsubUrl}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: ['abandoned-form', 'step-' + step]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return true;
}

// ----- Who is due ---------------------------------------------------------------------
async function candidates(now = Date.now()) {
  const [ids, done, unsub] = await pipe([['ZRANGEBYSCORE', 'drafts', String(now - LOOK_BACK), String(now - FIRST_AFTER)], ['SMEMBERS', 'drafts:done'], ['SMEMBERS', 'followup:unsub']]);
  if (!ids || !ids.length) return [];
  const finished = new Set(done || []), unsubbed = new Set(unsub || []);
  const open = ids.filter(id => !finished.has(id));
  if (!open.length) return [];
  const [rows] = await pipe([['MGET', ...open.map(id => 'draft:' + id)]]);
  const drafts = (rows || []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  // Anyone who has sent any form since is left alone.
  const sentEmails = new Set((await listEntries(5000)).map(e => emailOf((e.fields || {}).email || (e.fields || {}).work_email || (e.fields || {}).businessEmail)).filter(Boolean));
  const byEmail = new Map();
  for (const d of drafts) {
    const email = emailOf((d.fields || {}).email || (d.fields || {}).work_email || (d.fields || {}).businessEmail);
    if (!email || SKIP_EMAILS.test(email) || unsubbed.has(email) || sentEmails.has(email)) continue;
    if (SKIP_PAGES.test(String(d.page || '')) || SKIP_PAGES.test(String(d.form || ''))) continue;
    const prev = byEmail.get(email);
    if (!prev || (d.updated || 0) > (prev.updated || 0)) byEmail.set(email, Object.assign({}, d, { email }));
  }
  const list = [...byEmail.values()];
  if (!list.length) return [];
  const states = await pipe(list.map(d => ['HGETALL', 'followup:' + d.email]));
  const out = [];
  list.forEach((d, i) => {
    const st = {}; const a = states[i] || []; for (let k = 0; k < a.length; k += 2) st[a[k]] = a[k + 1];
    const canada = isCanada(d);
    if (canada && !consented(d.fields || {})) { out.push({ d, step: 0, why: 'Canada, no marketing consent' }); return; }
    if (!st.first) { if (now - (d.updated || 0) >= FIRST_AFTER) out.push({ d, step: 1 }); return; }
    if (!st.second && now - Number(st.first) >= SECOND_AFTER) out.push({ d, step: 2 });
  });
  return out;
}

// Runs at most once every 10 minutes no matter how often it is called.
async function run({ force = false } = {}) {
  if (!configured()) return { ran: false, reason: 'database not connected' };
  if (!force) { const [got] = await pipe([['SET', 'followup:lock', '1', 'NX', 'EX', 540]]); if (got !== 'OK') return { ran: false, reason: 'ran recently' }; }
  const due = await candidates();
  const live = enabled(), results = [];
  for (const c of due.filter(x => x.step).slice(0, PER_RUN)) {
    const rec = { at: Date.now(), email: c.d.email, step: c.step, form: c.d.form || '', page: c.d.page || '', draft: c.d.id, name: firstName(c.d.fields || {}), company: clean((c.d.fields || {}).company, 80) };
    if (!live) { results.push(Object.assign(rec, { status: 'preview' })); continue; }
    try {
      await send(c.d, c.step);
      await pipe([['HSET', 'followup:' + c.d.email, c.step === 1 ? 'first' : 'second', String(rec.at)], ['EXPIRE', 'followup:' + c.d.email, 400 * 86400], ['LPUSH', 'followup:log', JSON.stringify(Object.assign(rec, { status: 'sent' }))], ['LTRIM', 'followup:log', 0, 4999]]);
      results.push(rec);
    } catch (e) {
      rec.status = 'failed'; rec.error = e.message.slice(0, 200);
      await pipe([['LPUSH', 'followup:log', JSON.stringify(rec)], ['LTRIM', 'followup:log', 0, 4999]]);
      results.push(rec);
    }
  }
  return { ran: true, live, due: due.length, results, skipped: due.filter(x => !x.step).map(x => ({ email: x.d.email, why: x.why })) };
}

async function unsubscribe(t) {
  const email = emailOf(untoken(t));
  if (!email) return '';
  await pipe([['SADD', 'followup:unsub', email], ['LPUSH', 'followup:log', JSON.stringify({ at: Date.now(), email, status: 'unsubscribed' })]]);
  return email;
}

// What the "Finish your request" link puts back into the pop-up.
const RESUME_FIELDS = ['name', 'email', 'company', 'website', 'phoneCountry', 'phoneLocal', 'plan', 'target', 'budget'];
async function resume(t) {
  const id = untoken(t);
  if (!/^[a-z0-9]{12,40}$/i.test(id)) return null;
  const [raw] = await pipe([['GET', 'draft:' + id]]);
  if (!raw) return null;
  let d; try { d = JSON.parse(raw); } catch { return null; }
  const f = d.fields || {}, out = {};
  for (const k of RESUME_FIELDS) if (f[k]) out[k] = clean(f[k], 300);
  if (!out.email) { const e = emailOf(f.work_email || f.businessEmail); if (e) out.email = e; }
  if (!out.name) { const n = clean(f.fullName || [f.firstName, f.lastName].filter(Boolean).join(' '), 120); if (n) out.name = n; }
  return out;
}

async function log(limit = 500) {
  const [rows, unsub] = await pipe([['LRANGE', 'followup:log', 0, limit - 1], ['SCARD', 'followup:unsub']]);
  return { rows: (rows || []).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean), unsubscribed: Number(unsub) || 0 };
}

function preview() {
  const d = { id: 'abcdefabcdef12', email: 'jane@example.com', fields: { name: 'Jane Cooper', company: 'Northwind Logistics', target: 'VPs of Operations at mid-size freight companies' } };
  return { sender: SENDER, replyTo: REPLY_TO, step1: build(1, d), step2: build(2, d) };
}

module.exports = { run, candidates, unsubscribe, resume, log, preview, enabled, build, token, untoken, firstName, isCanada, SENDER };
