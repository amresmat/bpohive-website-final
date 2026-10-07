// One shared header (navigation bar) and footer for every page of the site.
// Runs last in the build so that no page can drift from the others.
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const LINKS = [
  ['Home', '/', rel => rel === 'index.html'],
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
const HOME_TITLE = 'BPO Hive | B2B Lead Generation & Appointment Setting';

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
        <img src="/assets/logo/bpohivelogo-white.png" alt="BPO Hive" width="400" height="130">
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
    <div class="bh-footer-bottom"><span>© ${YEAR} BPO Hive LLC. All rights reserved.</span><nav aria-label="Legal links"><a href="/privacy-policy">Privacy</a><a href="/terms-of-service">Terms</a><a href="/accessibility">Accessibility</a><a href="/cookie-policy">Cookies</a></nav></div>
  </div>
</footer>`;
}

// Fade content in as it scrolls into view. Only content below the first screen is affected,
// nothing is hidden unless this script runs, and reduced-motion visitors are left alone.
const REVEAL = `<script>(function(){
if(!('IntersectionObserver' in window)||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
var SEL='.scroll-animate,[class*="card"],.bento,.panel,article,details,.section-head,.aces-intro,.hero-proof,.logo-grid,.calculator-wrap,.visibility-panel,.platform-copy,.rounded-2xl,.rounded-3xl,.growth .content>*,.growth-links,main section h2,main section>div>h2+p';
var SKIP='.bh-header,.bh-footer,.aces-timeline,[role="dialog"],.hidden,[hidden],.leaflet-container,iframe';
function init(){var vh=window.innerHeight,chosen=[];
[].forEach.call(document.querySelectorAll(SEL),function(el){
if(el.closest(SKIP)||el.querySelector('.aces-rail,.leaflet-container'))return;
for(var i=0;i<chosen.length;i++)if(chosen[i].contains(el))return;
var r=el.getBoundingClientRect();if(!r.height||!r.width||r.height>vh*1.25||r.top<vh*.92)return;
var cs=getComputedStyle(el);if(cs.position==='fixed'||cs.position==='sticky'||cs.opacity==='0')return;
chosen.push(el);});
if(!chosen.length)return;
var rows={};
chosen.forEach(function(el){var key=Math.round(el.getBoundingClientRect().top+window.scrollY);rows[key]=(rows[key]||0);el.style.transitionDelay=Math.min(rows[key]*80,320)+'ms';rows[key]++;el.classList.add('bh-reveal');});
function done(el){el.classList.remove('bh-reveal','bh-in');el.style.transitionDelay='';}
var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(!en.isIntersecting)return;var el=en.target;io.unobserve(el);el.classList.add('bh-in');setTimeout(function(){done(el);},1300);});},{rootMargin:'0px 0px -8% 0px',threshold:.08});
chosen.forEach(function(el){io.observe(el);});}
if(document.readyState==='complete')init();else window.addEventListener('load',init);
})();</script>`;

function applyShell(html, rel) {
  const $ = cheerio.load(html);
  const body = $('body');
  // Skip redirect stubs and anything that is not a normal page.
  if (!body.length || (!$('body nav').length && !$('footer').length)) return null;
  // Old headers: any nav that is not inside the page content or a footer, plus old mobile menus.
  $('body > header').filter((i, e) => $(e).find('nav').length > 0).remove();
  $('nav').filter((i, e) => !$(e).closest('main,footer,article,section,details,aside').length).remove();
  $('#mobile-menu,.mobile-menu,.growth-mobile-book').remove();
  // No author/date lines anywhere on the site.
  $('.byline').remove();
  $('p,span,div').filter((i, e) => !$(e).children('p,div,section,ul,h1,h2,h3').length && /^\s*By\s+Amr Abdelrazzak\b/.test($(e).text())).remove();
  // The plain "Featured and listed" link block is not shown on any page.
  $('section.growth').filter((i, e) => /^\s*Featured and listed\s*$/i.test($(e).children('h2').first().text())).remove();
  $('footer').remove();
  const skip = body.children('.skip-link,a[href="#main"]').first();
  if (skip.length) skip.after(header(rel)); else body.prepend(header(rel));
  // Footer goes before trailing scripts so page scripts still run after the content exists.
  const firstTrailing = body.children().filter((i, e) => e.tagName !== 'script' && e.tagName !== 'noscript' && e.tagName !== 'style' && e.tagName !== 'link').last();
  if (firstTrailing.length) firstTrailing.after(footer(rel) + REVEAL); else body.append(footer(rel) + REVEAL);
  // One font source for every page: drop the old Google Fonts links and preload our own files
  // so text is drawn in the right font from the first frame.
  $('link[href*="fonts.googleapis.com"],link[href*="fonts.gstatic.com"]').remove();
  const preload = ['inter-latin-wght-normal.woff2', 'dm-sans-latin-wght-normal.woff2'].map(f => `<link rel="preload" href="/assets/fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('');
  const charset = $('head meta[charset]').first();
  if (charset.length) charset.after(preload); else $('head').prepend(preload);
  $('head').append('<link rel="stylesheet" href="/assets/css/site-shell.css">');
  // The homepage title is set here, last, so an earlier build step cannot replace it.
  if (rel === 'index.html') $('title').text(HOME_TITLE);
  body.addClass('bh-has-shell');
  return $.html();
}

// House style: no long dashes (em dashes) anywhere. Applied to the finished page so it also
// covers text added later through the admin.
function noLongDashes(html) {
  return html.replace(/(\s*)(?:—|&mdash;|&#8212;|&#x2014;)(\s*)/gi, (m, before, after, offset, all) => {
    const prev = all[offset - 1];
    if (prev === '>' || prev === undefined) {
      const tagStart = all.lastIndexOf('<', offset - 1);
      const tag = all.slice(tagStart, offset);
      // "<strong>Label</strong> — detail" becomes "Label: detail"; a dash that opens a line is dropped.
      return /^<\/(?:strong|b|em|i|a|span)>$/i.test(tag) ? ': ' : before;
    }
    return before && after ? ': ' : ', ';
  });
}

// House style: crisp corners. Large radii in each page's own <style> blocks are tightened here so
// every page follows the same rule (circles, written as 50%, are left alone).
function sharpCorners(html) {
  const radius = px => { const v = parseFloat(px); return v >= 999 ? '4px' : v >= 20 ? '10px' : v >= 13 ? '8px' : v >= 9 ? '6px' : px + 'px'; };
  return html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, css, close) => open + css.replace(/border-radius:\s*(\d+(?:\.\d+)?)px/g, (x, px) => 'border-radius:' + radius(px)) + close);
}

function shell(out) {
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'admin' && f.name !== 'assets') walk(p); continue; }
      if (!f.name.endsWith('.html')) continue;
      const rel = path.relative(out, p).split(path.sep).join('/');
      const html = fs.readFileSync(p, 'utf8');
      const next = sharpCorners(noLongDashes(applyShell(html, rel) || html));
      if (next !== html) fs.writeFileSync(p, next);
    }
  };
  walk(out);
}

module.exports = { sharpCorners, noLongDashes, shell, applyShell, header, footer };
