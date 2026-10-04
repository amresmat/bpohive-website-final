// One shared header (navigation bar) and footer for every page of the site.
// Runs last in the build so that no page can drift from the others.
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const LINKS = [
  ['Services', '/services', rel => rel === 'services.html' || rel.startsWith('services/')],
  ['Industries', '/industries', rel => rel === 'industries.html' || rel.startsWith('industries/')],
  ['About', '/about', rel => rel === 'about.html'],
  ['Case studies', '/case-studies', rel => rel === 'case-studies.html'],
  ['Blogs', '/blogs', rel => rel === 'blogs.html' || rel.startsWith('blog-') || rel.startsWith('guides/')],
  ['Careers', '/careers', rel => rel === 'careers.html'],
];
const SIGN_IN = 'https://analytics.bpohive.com';
const BOOK = '/outbound-assessment';
const EMAIL = 'info@bpohive.com';
const YEAR = '2026';

// The Careers page is for job applicants, so it carries no sales call, phone or WhatsApp links.
// Its main button keeps the same size and position but points at the open roles instead.
const isCareers = rel => rel === 'careers.html';
const cta = rel => isCareers(rel) ? '<a class="bh-btn bh-btn-solid" href="#open-positions">Open roles</a>' : `<a class="bh-btn bh-btn-solid" href="${BOOK}">Book a call</a>`;

function header(rel) {
  const link = ([label, href, on]) => `<a href="${href}"${on(rel) ? ' aria-current="page"' : ''}>${label}</a>`;
  const links = LINKS.map(link).join('');
  return `<header class="bh-header" data-site-shell>
  <div class="bh-shell bh-header-inner">
    <a class="bh-brand" href="/" aria-label="BPO Hive home"><img src="/assets/logo/bpohivelogo.png" alt="BPO Hive" width="400" height="130"></a>
    <nav class="bh-links" aria-label="Primary navigation">${links}</nav>
    <div class="bh-actions">
      <a class="bh-btn bh-btn-outline" href="${SIGN_IN}">Sign in</a>
      ${cta(rel)}
      <button class="bh-menu-btn" id="bh-menu-btn" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="bh-mobile-menu"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div class="bh-mobile-menu" id="bh-mobile-menu" hidden>
    <nav aria-label="Mobile navigation">${links}<a href="/roi-calculator">ROI calculator</a><a href="/contact">Contact</a><a href="${SIGN_IN}">Sign in</a></nav>
    ${cta(rel)}
  </div>
  <span id="mobile-menu-btn" hidden></span><span id="mobile-menu" hidden></span><span id="menu-btn" hidden></span>
</header>
<script>(function(){var b=document.getElementById('bh-menu-btn'),m=document.getElementById('bh-mobile-menu');if(!b||!m)return;function set(o){m.hidden=!o;b.setAttribute('aria-expanded',o?'true':'false');b.setAttribute('aria-label',o?'Close navigation':'Open navigation');b.classList.toggle('is-open',o);}b.addEventListener('click',function(){set(m.hidden);});document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false);});m.addEventListener('click',function(e){if(e.target.closest('a'))set(false);});window.addEventListener('resize',function(){if(window.innerWidth>1020)set(false);});})();</script>`;
}

function footer(rel) {
  const col = (title, items) => `<div class="bh-footer-col"><strong>${title}</strong>${items.map(([t, h, ext]) => `<a href="${h}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`).join('')}</div>`;
  return `<footer class="bh-footer" data-site-shell>
  <div class="bh-shell">
    <div class="bh-footer-grid">
      <div class="bh-footer-brand">
        <img src="/assets/logo/bpohivelogo.png" alt="BPO Hive" width="400" height="130">
        <p>Managed B2B appointment setting, lead generation, omnichannel execution, and live campaign reporting.</p>
        <p class="bh-footer-regions">Serving <a href="/appointment-setting-usa">USA</a>, <a href="/appointment-setting-canada">Canada</a> &amp; <a href="/gcc">GCC</a></p>
      </div>
      ${col('Company', [['About us', '/about'], ['Case studies', '/case-studies'], ['Blogs', '/blogs'], ['Careers', '/careers']])}
      ${col('Services', [['Appointment setting', '/services/appointment-setting'], ['Cold calling', '/services/cold-calling'], ['Email outreach', '/services/cold-email-outreach'], ['LinkedIn outreach', '/services/linkedin-lead-generation'], ['B2B data', '/services/lead-research']])}
      ${col('Resources', [['Industries', '/industries'], ['ROI calculator', '/roi-calculator'], ['LinkedIn', 'https://www.linkedin.com/company/bpohive', true], ['YouTube', 'https://www.youtube.com/@bpohive', true]])}
      <div class="bh-contact" id="contact-us">
        <strong>Contact us</strong>
        <a class="bh-contact-row" href="mailto:${EMAIL}"><span>Email</span>${EMAIL}</a>
        ${isCareers(rel) ? '' : `<a class="bh-contact-row" href="tel:+15026773800"><span>US / Canada</span>+1 502 677 3800</a>
        <a class="bh-contact-row" href="https://wa.me/971563755110" target="_blank" rel="noopener"><span>WhatsApp · UAE</span>+971 56 375 5110</a>`}
        ${cta(rel)}
      </div>
    </div>
    <div class="bh-footer-bottom"><span>© ${YEAR} BPO Hive. All rights reserved.</span><nav aria-label="Legal links"><a href="/privacy-policy">Privacy</a><a href="/terms-of-service">Terms</a><a href="/accessibility">Accessibility</a><a href="/cookie-policy">Cookies</a></nav></div>
  </div>
</footer>`;
}

function applyShell(html, rel) {
  const $ = cheerio.load(html);
  const body = $('body');
  // Skip redirect stubs and anything that is not a normal page.
  if (!body.length || (!$('body nav').length && !$('footer').length)) return null;
  // Old headers: any nav that is not inside the page content or a footer, plus old mobile menus.
  $('body > header').filter((i, e) => $(e).find('nav').length > 0).remove();
  $('nav').filter((i, e) => !$(e).closest('main,footer,article,section,details,aside').length).remove();
  $('#mobile-menu,.mobile-menu,.growth-mobile-book').remove();
  $('footer').remove();
  const skip = body.children('.skip-link,a[href="#main"]').first();
  if (skip.length) skip.after(header(rel)); else body.prepend(header(rel));
  // Footer goes before trailing scripts so page scripts still run after the content exists.
  const firstTrailing = body.children().filter((i, e) => e.tagName !== 'script' && e.tagName !== 'noscript' && e.tagName !== 'style' && e.tagName !== 'link').last();
  if (firstTrailing.length) firstTrailing.after(footer(rel)); else body.append(footer(rel));
  $('head').append('<link rel="stylesheet" href="/assets/css/site-shell.css">');
  body.addClass('bh-has-shell');
  return $.html();
}

function shell(out) {
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'admin' && f.name !== 'assets') walk(p); continue; }
      if (!f.name.endsWith('.html')) continue;
      const rel = path.relative(out, p).split(path.sep).join('/');
      const next = applyShell(fs.readFileSync(p, 'utf8'), rel);
      if (next) fs.writeFileSync(p, next);
    }
  };
  walk(out);
}

module.exports = { shell, applyShell, header, footer };
