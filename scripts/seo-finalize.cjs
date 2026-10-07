// Final SEO pass over the finished pages. Runs after every other build step.
// - one domain (www) everywhere
// - titles under 60 characters with the brand once
// - meta descriptions under 160 characters, unique where it matters
// - social preview tags (LinkedIn, WhatsApp, X) on every page
// - unused Calendly popup scripts removed (all booking goes through /outbound-assessment)
// - real "last modified" dates in the sitemap
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cheerio = require('cheerio');

const ORIGIN = 'https://www.bpohive.com';
const ROOT = path.resolve(__dirname, '..');
const SHARE_IMAGE = ORIGIN + '/assets/og/bpohive-share.png';
const BRAND = ' | BPO Hive';

// Hand-written descriptions for pages whose generated text is long or shared with other pages.
// Hand-written titles where the page's own title runs past 60 characters.
const TITLES = {
  'about.html': 'About BPO Hive: Our Team in Cairo and Dubai',
  'vs/belkins.html': 'BPO Hive vs Belkins: Appointment Setting Compared',
  'vs/salesroads.html': 'BPO Hive vs SalesRoads: Outsourced SDRs Compared',
  'vs/in-house-sdr.html': 'Outsourced SDR vs In-House SDR Team | BPO Hive',
  'appointment-setting-usa.html': 'B2B Appointment Setting Services in the USA | BPO Hive',
  'services/appointment-setting.html': 'B2B Appointment Setting Services | BPO Hive',
  'services/cold-calling.html': 'B2B Cold Calling Services | BPO Hive',
  'services/cold-email-outreach.html': 'B2B Cold Email Outreach Services | BPO Hive',
  'services/crm-services.html': 'CRM Support for Outbound Sales Teams | BPO Hive',
  'services/email-deliverability.html': 'Email Deliverability for B2B Outreach | BPO Hive',
  'services/lead-research.html': 'B2B Lead Research and Prospect Lists | BPO Hive',
  'services/linkedin-lead-generation.html': 'LinkedIn Lead Generation for B2B | BPO Hive',
  'services/sales-development.html': 'Outsourced SDR Services | BPO Hive',
  'appointment-setting-cost.html': 'How Much Does Appointment Setting Cost? | BPO Hive',
  'blog-real-estate-recruitment.html': 'How to Recruit Top Real Estate Agents | BPO Hive',
  'blog-roofing-hvac-lead-generation.html': 'Roofing & HVAC Lead Generation Pipeline | BPO Hive',
  'blogs.html': 'Blog: B2B Lead Generation Insights | BPO Hive',
  'case-studies.html': 'B2B Lead Generation Case Studies | BPO Hive',
  'industries.html': 'Industries We Serve: B2B Lead Generation | BPO Hive',
};

const DESCRIPTIONS = {
  'about.html': 'Meet the BPO Hive team: the people in Cairo and Dubai who research, call and book B2B meetings for companies in the USA, Canada and the GCC.',
  'appointment-setting-cost.html': 'What B2B appointment setting really costs: retainer vs pay-per-meeting, cost per held meeting, and how to work out break-even. BPO Hive starts at $4,000/month.',
  'services/appointment-setting.html': 'B2B appointment setting for the USA, Canada and the GCC. We research accounts, run outreach and book qualified meetings on your calendar. From $4,000/month.',
  'services/cold-calling.html': 'B2B cold calling with researched accounts, approved talk tracks and clear qualification, for the USA, Canada and the GCC. From $4,000/month.',
  'services/cold-email-outreach.html': 'B2B cold email outreach built on account research, short relevant messages and clean sending setup, for the USA, Canada and the GCC.',
  'services/crm-services.html': 'CRM support for outbound teams: clean stages, clear ownership, no duplicate records and reporting your sales team can trust.',
  'services/email-deliverability.html': 'Email deliverability support for B2B outreach: authentication, list quality, sending reputation and complaint handling.',
  'services/lead-research.html': 'B2B lead research and prospect lists built around your ICP, with buyer roles mapped and every record checked before outreach.',
  'services/linkedin-lead-generation.html': 'LinkedIn lead generation for B2B teams: relevant messages to the right roles, coordinated with phone and email. From $4,000/month.',
  'services/sales-development.html': 'Outsourced SDR services for the USA, Canada and the GCC: research, outreach, qualification and handoff to your closers. From $4,000/month.',
  'industries/saas.html': 'Lead generation and appointment setting for B2B SaaS companies: meetings with the functional leaders and budget owners who buy software.',
  'industries/consulting.html': 'Lead generation for consultancies and professional-services firms: meetings with sponsors who have a real business problem.',
  'industries/finance.html': 'Lead generation for B2B financial services and fintech providers: compliant outreach to finance leaders and operations teams.',
  'industries/hvac.html': 'Lead generation for commercial HVAC providers: meetings with facilities managers and property operators in your service area.',
  'industries/roofing.html': 'Lead generation for commercial roofing contractors: meetings with property owners and managers planning roof work.',
  'industries/solar-energy.html': 'Lead generation for commercial solar developers and installers: meetings with property owners and facilities leaders.',
  'industries/real-estate-recruitment.html': 'Agent recruitment outreach for real estate brokerages: confidential introductions with experienced agents in your markets.',
  'industries/real-estate-seller-leads.html': 'Outreach for real estate firms: conversations with commercial property owners and authorized representatives in your territory.',
  'industries/recruitment.html': 'Lead generation for staffing and recruitment agencies: meetings with hiring managers who need outside recruiting support.',
  'pricing.html': 'BPO Hive pricing: managed B2B appointment setting from $4,000 per month. See what the Validation Sprint, Growth and Enterprise programs include.',
  'services.html': 'B2B appointment setting, cold calling, email and LinkedIn outreach, lead research and SDR programs for the USA, Canada and the GCC.',
  'vs/belkins.html': 'BPO Hive vs Belkins: compare pricing, scope, markets and reporting before choosing a B2B appointment setting partner.',
  'vs/salesroads.html': 'BPO Hive vs SalesRoads: compare SDR staffing, billing periods, markets and total cost before you choose.',
  'vs/in-house-sdr.html': 'Outsourced SDRs or an in-house team? Compare cost, control, ramp-up time and management load for B2B outbound.',
  'guides/usa.html': 'A free planning workbook for US B2B outbound: time zones, contact rules, ICP and messaging worksheets.',
  'guides/canada.html': 'A free readiness guide for Canadian B2B outreach: provinces, CASL basics, language and scheduling worksheets.',
  'guides/gcc.html': 'A free calling guide for GCC B2B outreach: country rules, working weeks, and Arabic and English messaging worksheets.',
  'appointment-setting-usa.html': 'Managed B2B appointment setting for US sales teams: account research, phone, email and LinkedIn outreach, qualified meetings. From $4,000/month.',
  'appointment-setting-canada.html': 'B2B appointment setting for Canadian sales teams: province-level targeting, CASL-aware outreach and qualified meetings. From $4,000/month.',
  'appointment-setting-uae-dubai.html': 'B2B appointment setting in Dubai and the UAE: English and Arabic outreach, local buyer research and qualified meetings. From $4,000/month.',
  'appointment-setting-saudi-arabia.html': 'B2B appointment setting in Saudi Arabia: Arabic and English outreach to Riyadh, Jeddah and Eastern Province buyers. From $4,000/month.',
  'gcc.html': 'B2B appointment setting across the GCC: UAE, Saudi Arabia, Qatar, Kuwait, Bahrain and Oman, in Arabic and English. From $4,000/month.',
};

function shortTitle(t) {
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*·\s*BPO Hive(?=\s*\|\s*BPO Hive)/, '');
  if (t.length > 60) t = t.replace(/\s*·\s*USA, Canada & GCC/, '');
  if (t.length > 60) t = t.replace(/\s*·\s*From \$4,000(?:\/Month)?/i, '');
  return t;
}

function shortDescription(d) {
  d = d.replace(/\s+/g, ' ').trim();
  if (d.length <= 160) return d;
  const sentences = d.match(/[^.!?]+[.!?]+/g) || [d];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > 158) break;
    out += s;
  }
  out = out.trim();
  if (!out) out = d.slice(0, 155).replace(/\s+\S*$/, '') + '…';
  if (!out.includes('$4,000') && out.length + 21 <= 160) out += ' From $4,000/month.';
  return out;
}

function gitDate(files) {
  let best = '';
  for (const f of files) {
    try {
      const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (d > best) best = d;
    } catch { /* git not available */ }
  }
  return best;
}

function finalize(out) {
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['admin', 'assets'].includes(e.name)) walk(p); }
      else if (e.name.endsWith('.html')) files.push(p);
    }
  };
  walk(out);

  for (const file of files) {
    const rel = path.relative(out, file).split(path.sep).join('/');
    let html = fs.readFileSync(file, 'utf8').replace(/https:\/\/bpohive\.com/g, ORIGIN);
    const $ = cheerio.load(html);
    const head = $('head');
    if (!head.length) { fs.writeFileSync(file, html); continue; }

    // Calendly popup code is dead everywhere except the booking page.
    if (rel !== 'outbound-assessment.html') {
      $('script[src*="assets.calendly.com"],link[href*="assets.calendly.com"]').remove();
      $('script:not([src])').each((i, e) => { if (/Calendly\.initPopupWidget|openBookingModal/.test($(e).html() || '')) $(e).remove(); });
    }

    const title = TITLES[rel] || shortTitle($('title').first().text() || 'BPO Hive');
    $('title').first().text(title);
    let desc = DESCRIPTIONS[rel] || $('meta[name="description"]').attr('content') || '';
    desc = shortDescription(desc);
    if ($('meta[name="description"]').length) $('meta[name="description"]').attr('content', desc);
    else if (desc) head.append(`<meta name="description" content="${desc.replace(/"/g, '&quot;')}">`);

    const canonical = $('link[rel="canonical"]').attr('href') || '';
    const socialTitle = title.includes('BPO Hive') ? title : title + BRAND;
    const set = (attr, key, value) => {
      if (!value) return;
      const el = $(`meta[${attr}="${key}"]`);
      if (el.length) el.attr('content', value); else head.append(`<meta ${attr}="${key}" content="${String(value).replace(/"/g, '&quot;')}">`);
    };
    const keepImage = $('meta[property="og:image"]').attr('content');
    set('property', 'og:type', $('meta[property="og:type"]').attr('content') || 'website');
    set('property', 'og:site_name', 'BPO Hive');
    set('property', 'og:title', socialTitle);
    set('property', 'og:description', desc);
    if (canonical) set('property', 'og:url', canonical);
    set('property', 'og:image', keepImage && !/landing-page-hero/.test(keepImage) ? keepImage : SHARE_IMAGE);
    set('name', 'twitter:card', 'summary_large_image');
    set('name', 'twitter:title', socialTitle);
    set('name', 'twitter:description', desc);
    set('name', 'twitter:image', $('meta[property="og:image"]').attr('content'));

    fs.writeFileSync(file, $.html());
  }

  // Sitemap: real last-modified dates from the source files' history.
  const generated = ['scripts/growth-site.cjs', 'scripts/growth-content.cjs', 'lib/campaign-policy.cjs'];
  const sourcesFor = rel => {
    if (/^(services|industries|vs)\//.test(rel) || /^(appointment-setting|gcc|contact|resources)/.test(rel)) return generated;
    if (rel.startsWith('blog-')) return ['content/blog/' + rel.slice(5, -5) + '.json'];
    if (rel === 'index.html') return ['index.html', 'content/site/home.json'];
    if (rel === 'about.html') return ['about.html', 'content/team', 'content/site/offices.json'];
    if (rel === 'case-studies.html') return ['case-studies.html', 'content/case-studies'];
    return [rel];
  };
  const today = new Date().toISOString().slice(0, 10);
  const sitemapPath = path.join(out, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const xml = fs.readFileSync(sitemapPath, 'utf8').replace(/<url><loc>([^<]+)<\/loc><lastmod>[^<]*<\/lastmod><\/url>/g, (m, loc) => {
      const p = loc.replace(ORIGIN, '').replace(/^\//, '') || 'index';
      const date = gitDate(sourcesFor(p + '.html')) || today;
      return `<url><loc>${loc}</loc><lastmod>${date}</lastmod></url>`;
    });
    fs.writeFileSync(sitemapPath, xml);
  }
}

module.exports = { finalize, shortTitle, shortDescription };
