// Renders the admin-managed sections (jobs, team, offices, case studies, site settings)
// into the static pages at build time. Content lives in content/**.json.
const fs = require('node:fs');
const path = require('node:path');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (o, k, where) => { if (typeof o[k] !== 'string' || !o[k].trim()) throw Error(`${where}: missing ${k}`); return o[k].trim(); };
const opt = (o, k) => (typeof o[k] === 'string' ? o[k].trim() : '');
const httpsUrl = (v, where) => { let u; try { u = new URL(v); } catch { throw Error(`${where}: invalid link`); } if (u.protocol !== 'https:') throw Error(`${where}: link must start with https://`); return u.href; };
const image = (v, where) => { if (!/^\/assets\/[a-zA-Z0-9_./ -]+\.(?:png|jpe?g|webp|gif|avif)$/.test(v) || v.includes('..')) throw Error(`${where}: photo must be an image in assets`); return v; };
const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a._slug).localeCompare(String(b._slug));

function readFolder(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(f => f.endsWith('.json')).map(f => {
    const slug = f.slice(0, -5);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error(`${dir}/${f}: invalid file name`);
    return { _slug: slug, ...JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')) };
  }).sort(byOrder);
}

function between(html, name, content, open = '<!-- ', close = ' -->') {
  const a = `${open}BPO-HIVE-${name}:START${close}`, b = `${open}BPO-HIVE-${name}:END${close}`;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < i) throw Error(`Missing ${name} markers`);
  return html.slice(0, i + a.length) + '\n' + content + '\n' + html.slice(j);
}

// ---------- Jobs ----------
const ICON_PIN = '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
const ICON_CLOCK = '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
const ICON_ARROW = '<svg class="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>';
const jotformId = url => (url.match(/^https:\/\/(?:form\.jotform\.com|[a-z0-9-]+\.jotform\.com)\/(\d{6,})\/?$/) || [])[1];

function renderJobs(html, jobs) {
  const open = jobs.filter(j => j.open !== false).map(j => {
    const where = `Job ${j._slug}`;
    return { slug: j._slug, title: str(j, 'title', where), description: str(j, 'description', where), location: opt(j, 'location'), type: opt(j, 'type'), department: opt(j, 'department'), url: httpsUrl(str(j, 'apply_url', where), where) };
  });
  const btn = 'class="btn-primary inline-flex items-center px-6 py-3 text-white font-medium rounded-full"';
  const cards = open.map(j => {
    const embed = jotformId(j.url);
    const action = embed
      ? `<button onclick="openApplyModal('apply-modal-${j.slug}')" ${btn}>Apply Now ${ICON_ARROW}</button>`
      : `<a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer" ${btn}>Apply Now ${ICON_ARROW}</a>`;
    const tag = (icon, text) => text ? `<span class="tag px-3 py-1 bg-gray-100 text-bpo-gray text-sm rounded-full flex items-center">${icon}${esc(text)}</span>` : '';
    return `<div class="job-card scroll-animate bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
    <div class="flex-1">
      <h3 class="text-xl font-bold text-bpo-dark mb-2">${esc(j.title)}</h3>
      <p class="text-bpo-gray mb-4">${esc(j.description)}</p>
      <div class="flex flex-wrap gap-2">${tag(ICON_PIN, j.location)}${tag(ICON_CLOCK, j.type)}${j.department ? `<span class="tag px-3 py-1 bg-blue-50 text-bpo-blue text-sm rounded-full font-medium">${esc(j.department)}</span>` : ''}</div>
    </div>
    <div class="md:ml-6">${action}</div>
  </div>
</div>`;
  });
  if (!cards.length) cards.push('<div class="bg-white rounded-2xl p-8 border border-gray-200 text-center text-bpo-gray">There are no open positions right now. Please check back soon.</div>');
  const modals = open.filter(j => jotformId(j.url)).map(j => {
    const id = jotformId(j.url), modal = `apply-modal-${j.slug}`;
    return `<div role="dialog" aria-modal="true" aria-label="Job application" id="${modal}" class="fixed inset-0 z-[100] hidden">
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onclick="closeApplyModal('${modal}')"></div>
  <div class="absolute inset-4 md:inset-10 lg:inset-20 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
    <div class="flex items-center justify-between p-4 border-b border-gray-200">
      <h3 class="text-xl font-bold text-bpo-dark">Apply: ${esc(j.title)}</h3>
      <button aria-label="Close application" onclick="closeApplyModal('${modal}')" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"><svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
    </div>
    <div class="flex-1 overflow-auto">
      <p style="margin:0;padding:12px 16px;background:#f3f9fd;font-size:14px"><a href="${esc(j.url)}" target="_blank" rel="noopener noreferrer" style="color:#126aa5;text-decoration:underline">Open application in a new tab</a></p>
      <iframe id="JotFormIFrame-${id}" title="${esc(j.title)} application" allowtransparency="true" allow="geolocation; microphone; camera; fullscreen" src="${esc(j.url)}" frameborder="0" style="width:100%;height:100%;min-height:600px;border:none;" scrolling="yes" loading="lazy"></iframe>
    </div>
  </div>
</div>`;
  });
  html = between(html, 'ROLES', cards.join('\n'));
  html = between(html, 'MODALS', modals.join('\n'));
  const n = open.length;
  return html.replace(/(<span id="role-count"[^>]*>)[^<]*(<\/span>)/, (_, a, b) => `${a}${n} position${n === 1 ? '' : 's'}${b}`);
}

// ---------- Team ----------
const ICON_LINKEDIN = '<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>';

function renderTeam(html, team) {
  const cards = team.map(m => {
    const where = `Team member ${m._slug}`;
    const name = str(m, 'name', where), title = str(m, 'title', where), bio = opt(m, 'bio'), linkedin = opt(m, 'linkedin');
    const photo = image(str(m, 'photo', where), where);
    const pos = /^[a-z0-9% .-]{1,30}$/i.test(opt(m, 'photo_position')) ? opt(m, 'photo_position') : 'center';
    return `<div class="team-card scroll-animate bg-white rounded-2xl overflow-hidden shadow-lg border border-gray-100">
  <div class="relative overflow-hidden aspect-[4/5]">
    <img src="${esc(photo)}" alt="${esc(name)} - ${esc(title)}" loading="lazy" class="team-image w-full h-full object-cover" style="object-position:${esc(pos)}">
  </div>
  <div class="p-6">
    <h3 class="text-xl font-bold text-belkins-dark">${esc(name)}</h3>
    <p class="text-bpo-blue font-medium mb-3">${esc(title)}</p>
    ${bio ? `<p class="text-belkins-gray text-sm mb-4">${esc(bio)}</p>` : ''}
    ${linkedin ? `<a href="${esc(httpsUrl(linkedin, where))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-[#0A66C2] hover:underline text-sm font-medium">${ICON_LINKEDIN}Connect on LinkedIn</a>` : ''}
  </div>
</div>`;
  });
  return between(html, 'TEAM', cards.join('\n'));
}

// ---------- Offices ----------
function renderOffices(html, data) {
  const list = Array.isArray(data.offices) ? data.offices : [];
  if (!list.length) throw Error('Offices: add at least one office');
  const offices = list.map((o, i) => {
    const where = `Office ${i + 1}`;
    const lat = Number(o.lat), lng = Number(o.lng);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw Error(`${where}: invalid map position`);
    return { name: str(o, 'name', where), tag: opt(o, 'tag'), subtitle: opt(o, 'subtitle'), l1: str(o, 'address_line1', where), l2: opt(o, 'address_line2'), lat, lng, hq: o.is_hq === true };
  });
  const pin = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />';
  const cards = offices.map(o => `<div onclick="zoomToLocation(${o.lat}, ${o.lng})" class="location-card scroll-animate bg-white rounded-2xl p-6 shadow-lg ${o.hq ? 'border-2 border-bpo-blue' : 'border border-gray-100 hover:border-bpo-blue'} cursor-pointer hover:shadow-xl transition-all">
  <div class="flex flex-col">
    <div class="flex items-center justify-between mb-4">
      <div class="w-12 h-12 ${o.hq ? 'bg-bpo-blue' : 'bg-gray-100'} rounded-xl flex items-center justify-center"><svg class="w-6 h-6 ${o.hq ? 'text-white' : 'text-bpo-blue'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">${pin}</svg></div>
      ${o.tag ? `<span class="px-2 py-1 ${o.hq ? 'bg-bpo-blue/10 text-bpo-blue' : 'bg-gray-100 text-belkins-gray'} text-xs font-semibold rounded-full">${esc(o.tag)}</span>` : ''}
    </div>
    <h3 class="text-xl font-bold text-belkins-dark mb-1">${esc(o.name)}</h3>
    <p class="text-belkins-gray text-sm">${esc(o.l1)}</p>
    ${o.l2 ? `<p class="text-belkins-gray text-sm">${esc(o.l2)}</p>` : ''}
    <p class="text-bpo-blue text-xs mt-2 font-medium">Click to view on map &rarr;</p>
  </div>
</div>`);
  // The map script inserts these values into popup HTML, so they are HTML-escaped here.
  const js = offices.map(o => {
    const address = [o.l1, o.l2].filter(Boolean).join(', ');
    return { name: esc(o.name), subtitle: esc(o.subtitle), address: esc(address), lat: o.lat, lng: o.lng, isHQ: o.hq, googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${address}, ${o.name}`) };
  });
  html = between(html, 'OFFICE-CARDS', cards.join('\n'));
  return between(html, 'OFFICES', JSON.stringify(js, null, 2).replace(/</g, '\\u003c'), '/*', '*/');
}

// ---------- Case studies ----------
function renderCaseStudies(html, studies) {
  const cards = studies.map(c => {
    const where = `Case study ${c._slug}`;
    const metrics = (Array.isArray(c.metrics) ? c.metrics : []).filter(m => m && opt(m, 'value')).slice(0, 3);
    const block = (color, label, text) => text ? `<div><h4 class="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center"><span class="w-2 h-2 ${color} rounded-full mr-2"></span> ${label}</h4><p class="text-gray-600 leading-relaxed">${esc(text)}</p></div>` : '';
    return `<article class="relative bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden group hover:border-bpo-blue/30 transition-all">
  <div class="p-8 md:p-12">
    <div class="flex flex-col md:flex-row md:items-start justify-between gap-8 mb-8">
      <div>
        ${opt(c, 'duration') ? `<span class="inline-block px-3 py-1 bg-blue-50 text-bpo-blue text-xs font-semibold rounded-full uppercase tracking-wider mb-4">${esc(opt(c, 'duration'))}</span>` : ''}
        <h3 class="text-3xl font-bold text-gray-900 mb-2">${esc(str(c, 'title', where))}</h3>
        <p class="text-xl text-gray-500">${esc(opt(c, 'subtitle'))}</p>
      </div>
      ${opt(c, 'value') ? `<div class="text-right"><div class="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg"><span class="text-sm text-gray-500">${esc(opt(c, 'value_label') || 'Value Generated:')}</span><span class="text-lg font-bold text-bpo-blue">${esc(opt(c, 'value'))}</span></div></div>` : ''}
    </div>
    ${metrics.length ? `<div class="grid grid-cols-1 md:grid-cols-3 gap-8 py-8 border-y border-gray-100 mb-8">${metrics.map(m => `<div><div class="text-3xl font-bold text-gray-900">${esc(opt(m, 'value'))}</div><div class="text-xs text-gray-400 uppercase tracking-wide mt-1">${esc(opt(m, 'label'))}</div></div>`).join('')}</div>` : ''}
    <div class="grid md:grid-cols-3 gap-12">${block('bg-red-400', 'Challenge', opt(c, 'challenge'))}${block('bg-blue-400', 'Solution', opt(c, 'solution'))}${block('bg-green-400', 'Result', opt(c, 'result'))}</div>
    <a href="outbound-assessment.html" class="mt-4 inline-flex items-center px-6 py-2 bg-[#4EA6FE] text-white font-medium rounded-full text-sm hover:bg-[#3d9aef] transition-colors">Get Similar Results</a>
  </div>
</article>`;
  });
  return between(html, 'CASE-STUDIES', cards.join('\n\n'));
}

// ---------- Site-wide settings ----------
const DEFAULTS = { signin_url: 'https://analytics.bpohive.com', contact_email: 'info@bpohive.com', calendly_url: 'https://calendly.com/d/cxkp-cvw-qyg' };

function settingsReplacer(settings) {
  const pairs = [];
  const signin = httpsUrl(opt(settings, 'signin_url') || DEFAULTS.signin_url, 'Sign in link').replace(/\/$/, '');
  const calendly = httpsUrl(opt(settings, 'calendly_url') || DEFAULTS.calendly_url, 'Booking link');
  const email = opt(settings, 'contact_email') || DEFAULTS.contact_email;
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email)) throw Error('Contact email is invalid');
  if (signin !== DEFAULTS.signin_url) pairs.push([DEFAULTS.signin_url, esc(signin)]);
  if (calendly !== DEFAULTS.calendly_url) pairs.push([DEFAULTS.calendly_url, esc(calendly).replace(/&#39;/g, '%27')]);
  if (email !== DEFAULTS.contact_email) pairs.push([DEFAULTS.contact_email, esc(email)]);
  return html => pairs.reduce((h, [from, to]) => h.split(from).join(to), html);
}

function buildSections(root, out) {
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const json = (p, fallback) => fs.existsSync(path.join(root, p)) ? JSON.parse(read(p)) : fallback;
  fs.writeFileSync(path.join(out, 'careers.html'), renderJobs(read('careers.html'), readFolder(root, 'content/jobs')));
  let about = renderTeam(read('about.html'), readFolder(root, 'content/team'));
  about = renderOffices(about, json('content/site/offices.json', {}));
  fs.writeFileSync(path.join(out, 'about.html'), about);
  fs.writeFileSync(path.join(out, 'case-studies.html'), renderCaseStudies(read('case-studies.html'), readFolder(root, 'content/case-studies')));
  const apply = settingsReplacer(json('content/site/settings.json', {}));
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (f.name !== 'admin' && f.name !== 'assets') walk(p); } else if (f.name.endsWith('.html')) { const before = fs.readFileSync(p, 'utf8'), after = apply(before); if (after !== before) fs.writeFileSync(p, after); } } };
  walk(out);
}

module.exports = { buildSections, renderJobs, renderTeam, renderOffices, renderCaseStudies, settingsReplacer, readFolder };
