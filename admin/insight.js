// Admin "Analytics" section: overview, visitor recordings (replay) and form drop-off.
// Reads from /api/admin/insight; the website's /assets/js/insight.js collects the data.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var main, RANGE = 30, SESS = { rows: [], total: 0, loaded: false }, player = null;
  var FIELD_LABELS = { name: 'Name', email: 'Work email', company: 'Company', website: 'Website', phoneCountry: 'Phone country', phoneLocal: 'Phone number', plan: 'Campaign size', target: 'Who you want meetings with', budget: 'Monthly budget', message: 'Message', targetMarket: 'Target market', region: 'Region', firstName: 'First name', lastName: 'Last name', phone: 'Phone' };
  var POPUP_ORDER = ['name', 'email', 'company', 'website', 'phoneCountry', 'phoneLocal', 'plan', 'target', 'budget'];
  var TAG_LABELS = { pageview: 'Page view', popup_open: 'Opened the pop-up', popup_close: 'Closed the pop-up', popup_submit: 'Submitted the pop-up', booked: 'Booked a call', time_selected: 'Picked a time', field: 'Field', form_submit: 'Sent a form', scroll_depth: 'Scrolled', js_error: 'Page error' };
  var COUNTRY = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

  function api(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch('/api/admin/insight?' + q, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (r.status === 401) { location.reload(); throw new Error('Signed out'); } if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }); });
  }
  function country(c) { if (!c) return ''; try { return COUNTRY ? COUNTRY.of(c) : c; } catch (e) { return c; } }
  function flag(c) { if (!/^[A-Z]{2}$/.test(c || '')) return ''; return String.fromCodePoint.apply(null, c.split('').map(function (ch) { return 0x1F1E6 + ch.charCodeAt(0) - 65; })); }
  function dur(s) { s = Math.round(s || 0); if (s < 60) return s + 's'; var m = Math.floor(s / 60); return m + 'm ' + (s % 60) + 's'; }
  function when(ts) { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function ago(ts) { var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; var h = Math.round(m / 60); if (h < 24) return h + ' h ago'; var d = Math.round(h / 24); return d + ' day' + (d > 1 ? 's' : '') + ' ago'; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }
  function label(name) { return FIELD_LABELS[name] || name; }
  function rangeSel(cur) { return '<select id="ins-range">' + [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === cur ? ' selected' : '') + '>Last ' + d + ' days</option>'; }).join('') + '</select>'; }
  function head(title, sub, extra) { return '<div class="ins-head"><div><h1>' + title + '</h1><p class="sub">' + sub + '</p></div><div class="bar" style="margin:0">' + (extra || '') + '</div></div>'; }
  function tabs(cur) { return '<div class="tabs">' + [['overview', '#insight', 'Overview'], ['pages', '#insight/pages', 'Pages'], ['sessions', '#insight/sessions', 'Recordings'], ['forms', '#insight/forms', 'Forms']].map(function (t) { return '<a class="tab' + (cur === t[0] ? ' on' : '') + '" href="' + t[1] + '">' + t[2] + '</a>'; }).join('') + '</div>'; }
  function table(title, rows, cols) {
    return '<div class="card ins-table"><h3>' + esc(title) + '</h3>' + (rows.length ? '<table><thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + c.f(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No data yet.</div>') + '</div>';
  }
  function barCell(n, max) { return '<div class="ins-bar"><i style="width:' + pct(n, max) + '%"></i><span>' + n + '</span></div>'; }

  /* ---------- Overview ---------- */
  var SOURCE_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity', gemini: 'Google Gemini', copilot: 'Microsoft Copilot', 'you.com': 'You.com', poe: 'Poe', mistral: 'Mistral', deepseek: 'DeepSeek', grok: 'Grok', 'meta ai': 'Meta AI', 'duck.ai': 'Duck.ai', google: 'Google search', bing: 'Bing search', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', 'google ads': 'Google Ads', linkedin: 'LinkedIn', facebook: 'Facebook / Instagram', x: 'X (Twitter)', youtube: 'YouTube', clutch: 'Clutch', direct: 'Direct (typed the address or a bookmark)', followup: 'Follow-up email' };
  var AI = { chatgpt: 1, claude: 1, perplexity: 1, gemini: 1, copilot: 1, 'you.com': 1, poe: 1, mistral: 1, deepseek: 1, grok: 1, 'meta ai': 1, 'duck.ai': 1 };
  function srcLabel(name) { return SOURCE_LABELS[name] || name; }
  var FILTER = { country: '', source: '' };
  function filterSel(rows) {
    var countries = {}, sources = {}; rows.forEach(function (r) { if (r.country) countries[r.country] = (countries[r.country] || 0) + 1; if (r.source) sources[r.source] = (sources[r.source] || 0) + 1; });
    var cOpts = Object.keys(countries).sort(function (a, b) { return countries[b] - countries[a]; }).map(function (c) { return '<option value="' + esc(c) + '"' + (FILTER.country === c ? ' selected' : '') + '>' + flag(c) + ' ' + esc(country(c)) + ' (' + countries[c] + ')</option>'; }).join('');
    var sOpts = Object.keys(sources).sort(function (a, b) { return sources[b] - sources[a]; }).map(function (x) { return '<option value="' + esc(x) + '"' + (FILTER.source === x ? ' selected' : '') + '>' + esc(srcLabel(x)) + ' (' + sources[x] + ')</option>'; }).join('');
    var ai = rows.filter(function (r) { return AI[r.source]; }).length;
    return '<select id="ins-country"><option value="">All countries</option>' + cOpts + '</select><select id="ins-source"><option value="">All sources</option><option value="__ai"' + (FILTER.source === '__ai' ? ' selected' : '') + '>Any AI assistant (' + ai + ')</option>' + sOpts + '</select>';
  }
  function applyFilter(rows) { return rows.filter(function (r) { if (FILTER.country && r.country !== FILTER.country) return false; if (FILTER.source === '__ai') return AI[r.source]; if (FILTER.source && r.source !== FILTER.source) return false; return true; }); }
  function wireFilters(redraw) {
    $('ins-country').onchange = function () { FILTER.country = this.value; redraw(); };
    $('ins-source').onchange = function () { FILTER.source = this.value; redraw(); };
  }
  function count(rows, key, fn) { var o = {}; rows.forEach(function (r) { var k = fn ? fn(r) : r[key]; if (k) o[k] = (o[k] || 0) + 1; }); return Object.keys(o).map(function (k) { return { name: k, n: o[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 25); }
  var OV = null;
  function overview() {
    main.innerHTML = head('Analytics', 'Who visits bpohive.com, how they found it, and where the lead pop-up loses people.', rangeSel(RANGE)) + tabs('overview') + '<div class="bar" id="ins-filters"></div><div id="ins-body"><div class="empty">Loading…</div></div>';
    $('ins-range').onchange = function () { RANGE = +this.value; overview(); };
    Promise.all([api({ view: 'overview', days: RANGE }), api({ view: 'sessions', days: RANGE, limit: 3000 })]).then(function (r) {
      OV = { o: r[0], rows: r[1].rows || [] };
      $('ins-filters').innerHTML = filterSel(OV.rows);
      wireFilters(drawOverview); drawOverview();
    }).catch(function (e) { $('ins-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function drawOverview() {
    var o = OV.o, rows = applyFilter(OV.rows), filtered = Boolean(FILTER.country || FILTER.source), body = '';
    var t = { s: rows.length, pv: rows.reduce(function (a, r) { return a + r.pages; }, 0), open: rows.filter(function (r) { return r.popup; }).length, submit: rows.filter(function (r) { return r.submit; }).length, booked: rows.filter(function (r) { return r.booked; }).length, err: rows.filter(function (r) { return r.errors; }).length };
    var avgTime = rows.length ? Math.round(rows.reduce(function (a, r) { return a + r.duration; }, 0) / rows.length) : 0;
    body += (filtered ? '<p class="ins-note" style="margin:0 0 12px">Showing ' + rows.length + ' of ' + OV.rows.length + ' visitors' + (FILTER.country ? ' from ' + esc(country(FILTER.country)) : '') + (FILTER.source ? ' who came via ' + esc(FILTER.source === '__ai' ? 'an AI assistant' : srcLabel(FILTER.source)) : '') + '.</p>' : '');
    body += '<div class="ins-tiles">' + [
      ['Visitors', t.s, 'sessions'], ['Page views', t.pv, t.s ? (t.pv / t.s).toFixed(1) + ' per visit' : ''], ['Time on site', dur(avgTime), 'average'],
      ['Opened the pop-up', t.open, pct(t.open, t.s) + '% of visitors'], ['Submitted', t.submit, pct(t.submit, t.open) + '% of openers'], ['Booked a call', t.booked, pct(t.booked, t.submit) + '% of submitters']
    ].map(function (x) { return '<div class="ins-tile"><small>' + x[0] + '</small><b>' + (typeof x[1] === 'number' ? x[1].toLocaleString() : x[1]) + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
    var daily = o.daily.map(function (d) { return { date: d.date, s: 0, pv: 0 }; }), byDate = {}; daily.forEach(function (d) { byDate[d.date] = d; });
    rows.forEach(function (r) { var k = new Date(r.start).toISOString().slice(0, 10).replace(/-/g, ''); if (byDate[k]) { byDate[k].s++; byDate[k].pv += r.pages; } });
    body += '<div class="card ins-chart"><h3>Visitors per day</h3>' + chart(daily) + '</div>';
    body += '<div class="card ins-funnel"><h3>Lead pop-up funnel</h3>' + funnel([['Visitors', t.s], ['Opened the pop-up', t.open], ['Submitted', t.submit], ['Booked a call', t.booked]]) + '</div>';
    var pages = {}; rows.forEach(function (r) { Object.keys(r.paths || {}).forEach(function (p) { pages[p] = (pages[p] || 0) + r.paths[p]; }); });
    var pageRows = Object.keys(pages).map(function (p) { return { name: p, n: pages[p] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 25);
    var maxPage = Math.max.apply(null, [1].concat(pageRows.map(function (p) { return p.n; }))), scroll = {}; o.scroll.forEach(function (s) { scroll[s.path] = s.pct; });
    var sources = count(rows, 'source'), countries = count(rows, 'country'), devices = count(rows, 'device'), browsers = count(rows, 'browser'), refs = count(rows, null, function (r) { return r.ref && !/bpohive\.com$/.test(r.ref) ? r.ref : ''; }), cities = count(rows, null, function (r) { return r.city ? r.city + ', ' + country(r.country) : ''; });
    var aiRows = sources.filter(function (x) { return AI[x.name]; }), aiTotal = aiRows.reduce(function (a, x) { return a + x.n; }, 0);
    body += '<div class="ins-grid">';
    body += table('Where visitors come from', sources, [{ h: 'Source', f: function (r) { return esc(srcLabel(r.name)) + (AI[r.name] ? ' <span class="tag">AI</span>' : ''); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, sources[0].n); } }, { h: 'Booked', num: true, f: function (r) { return rows.filter(function (x) { return x.source === r.name && x.booked; }).length || ''; } }]);
    body += table('Countries', countries, [{ h: 'Country', f: function (r) { return flag(r.name) + ' ' + esc(country(r.name)); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, countries[0].n); } }, { h: 'Booked', num: true, f: function (r) { return rows.filter(function (x) { return x.country === r.name && x.booked; }).length || ''; } }]);
    body += table('AI assistants (' + aiTotal + ' visitors)', aiRows, [{ h: 'Assistant', f: function (r) { return esc(srcLabel(r.name)); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, aiRows[0].n); } }]);
    body += table('Cities', cities, [{ h: 'City', f: function (r) { return esc(r.name); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, cities[0].n); } }]);
    body += table('Top pages', pageRows, [{ h: 'Page', f: function (r) { return '<a href="' + esc(r.name) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>'; } }, { h: 'Views', f: function (r) { return barCell(r.n, maxPage); } }, { h: 'Avg scroll', num: true, f: function (r) { return !filtered && scroll[r.name] != null ? scroll[r.name] + '%' : ''; } }]);
    body += table('Devices and browsers', devices.concat(browsers), [{ h: 'Type', f: function (r) { return esc(r.name); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, (devices[0] || { n: 1 }).n); } }]);
    body += table('Referring sites', refs, [{ h: 'Site', f: function (r) { return esc(r.name); } }, { h: 'Visitors', f: function (r) { return barCell(r.n, refs[0].n); } }]);
    body += '</div>';
    body += '<p class="ins-note">Recordings kept for ' + o.storage.keepDays + ' days. Storage used: ' + mb(o.storage.bytes) + ' of ' + mb(o.storage.budget) + ' (' + o.storage.sessions.toLocaleString() + ' sessions stored). Visitors with ad blockers may not be counted. An AI assistant shows up as the source when the visitor clicked a link inside ChatGPT, Claude, Perplexity, Gemini or Copilot.</p>';
    $('ins-body').innerHTML = body;
  }
  function chart(daily) {
    var W = 900, H = 220, pad = 28, n = daily.length, max = Math.max(1, Math.max.apply(null, daily.map(function (d) { return Math.max(d.s, d.pv); })));
    var bw = (W - pad * 2) / n, x = function (i) { return pad + i * bw; }, y = function (v) { return H - pad - (v / max) * (H - pad * 2); };
    var bars = daily.map(function (d, i) { return '<rect x="' + (x(i) + bw * 0.15) + '" y="' + y(d.s) + '" width="' + (bw * 0.7) + '" height="' + (H - pad - y(d.s)) + '" rx="2" fill="#0f7ac4"><title>' + d.date.slice(0, 4) + '-' + d.date.slice(4, 6) + '-' + d.date.slice(6) + ': ' + d.s + ' visitors, ' + d.pv + ' page views</title></rect>'; }).join('');
    var line = daily.map(function (d, i) { return (i ? 'L' : 'M') + (x(i) + bw / 2) + ' ' + y(d.pv); }).join(' ');
    var labels = daily.map(function (d, i) { if (n > 14 && i % Math.ceil(n / 10)) return ''; return '<text x="' + (x(i) + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#5d7280">' + d.date.slice(6) + '/' + d.date.slice(4, 6) + '</text>'; }).join('');
    return '<div class="ins-scroll"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ins-svg" role="img" aria-label="Visitors and page views per day">' + (max >= 2 ? [0, 0.5, 1] : [0, 1]).map(function (f) { return '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="#edf3f7"/><text x="' + (pad - 6) + '" y="' + (y(max * f) + 4) + '" text-anchor="end" font-size="11" fill="#5d7280">' + Math.round(max * f) + '</text>'; }).join('') + bars + '<path d="' + line + '" fill="none" stroke="#0d1d2b" stroke-width="2"/>' + labels + '</svg></div><div class="ins-legend"><span><i style="background:#0f7ac4"></i>Visitors</span><span><i style="background:#0d1d2b;height:2px"></i>Page views</span></div>';
  }
  function funnel(steps) {
    var max = Math.max(1, steps[0][1]);
    return '<div class="ins-steps">' + steps.map(function (s, i) { var prev = i ? steps[i - 1][1] : s[1]; return '<div class="ins-step"><div class="ins-step-l"><b>' + esc(s[0]) + '</b><span>' + s[1].toLocaleString() + (i ? ' · ' + pct(s[1], prev) + '% of previous step' : '') + '</span></div><div class="ins-bar big"><i style="width:' + Math.max(1, pct(s[1], max)) + '%"></i></div></div>'; }).join('') + '</div>';
  }


  /* ---------- Pages ---------- */
  var PG = null, PSORT = 'views';
  function pagesView() {
    main.innerHTML = head('Pages', 'The most visited pages on bpohive.com, and which ones lead to booked calls.', rangeSel(RANGE)) + tabs('pages') + '<div class="bar" id="ins-filters"></div><div id="ins-body"><div class="empty">Loading…</div></div>';
    $('ins-range').onchange = function () { RANGE = +this.value; pagesView(); };
    Promise.all([api({ view: 'overview', days: RANGE }), api({ view: 'sessions', days: RANGE, limit: 3000 })]).then(function (r) {
      PG = { o: r[0], rows: r[1].rows || [] };
      $('ins-filters').innerHTML = filterSel(PG.rows) + '<select id="ins-sort"><option value="views">Sort by views</option><option value="visitors">Sort by visitors</option><option value="entries">Sort by landings</option><option value="booked">Sort by booked calls</option><option value="scroll">Sort by scroll depth</option></select>';
      $('ins-sort').value = PSORT; $('ins-sort').onchange = function () { PSORT = this.value; drawPages(); };
      wireFilters(drawPages); drawPages();
    }).catch(function (e) { $('ins-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function drawPages() {
    var rows = applyFilter(PG.rows), filtered = Boolean(FILTER.country || FILTER.source), scroll = {}, map = {};
    PG.o.scroll.forEach(function (x) { scroll[x.path] = x.pct; });
    rows.forEach(function (r) {
      Object.keys(r.paths || {}).forEach(function (p) {
        var m = map[p] = map[p] || { path: p, views: 0, visitors: 0, entries: 0, popup: 0, booked: 0 };
        m.views += r.paths[p]; m.visitors++; if (r.popup) m.popup++; if (r.booked) m.booked++;
      });
      if (r.entry && map[r.entry]) map[r.entry].entries++;
    });
    var list = Object.keys(map).map(function (k) { var m = map[k]; m.scroll = filtered ? null : (scroll[k] != null ? scroll[k] : null); return m; });
    list.sort(function (a, b) { return (b[PSORT] || 0) - (a[PSORT] || 0) || b.views - a.views; });
    var totalViews = list.reduce(function (a, m) { return a + m.views; }, 0), max = Math.max(1, Math.max.apply(null, list.map(function (m) { return m.views; })));
    var body = '<div class="ins-tiles">' + [['Pages viewed', list.length, 'different pages'], ['Page views', totalViews, rows.length ? (totalViews / rows.length).toFixed(1) + ' per visitor' : ''], ['Most visited', list.length ? list.slice().sort(function (a, b) { return b.views - a.views; })[0].path : '–', ''], ['Top landing page', list.length ? list.slice().sort(function (a, b) { return b.entries - a.entries; })[0].path : '–', '']].map(function (x) { return '<div class="ins-tile"><small>' + x[0] + '</small><b' + (typeof x[1] === 'string' ? ' class="ins-path"' : '') + '>' + esc(typeof x[1] === 'number' ? x[1].toLocaleString() : x[1]) + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
    body += '<div class="card tablewrap ins-table"><table><thead><tr><th>Page</th><th>Views</th><th class="num">Visitors</th><th class="num">Landed here</th><th class="num">Avg scroll</th><th class="num">Opened pop-up</th><th class="num">Booked a call</th></tr></thead><tbody>' +
      (list.length ? list.map(function (m) { return '<tr' + (m.booked ? ' class="is-booked"' : '') + '><td><a href="' + esc(m.path) + '" target="_blank" rel="noopener">' + esc(m.path) + '</a></td><td>' + barCell(m.views, max) + '</td><td class="num">' + m.visitors + '</td><td class="num">' + m.entries + '</td><td class="num">' + (m.scroll != null ? m.scroll + '%' : '') + '</td><td class="num">' + (m.popup || '') + '</td><td class="num">' + (m.booked ? '<span class="tag ok">' + m.booked + '</span>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">No page views yet.</td></tr>') + '</tbody></table></div>';
    body += '<p class="ins-note">Views count every time a page was opened. Visitors counts people. "Landed here" is the first page of their visit. "Booked a call" counts visitors who saw this page during a visit that ended in a booking.' + (filtered ? ' Scroll depth is only shown without filters.' : '') + '</p>';
    $('ins-body').innerHTML = body;
  }

  /* ---------- Recordings list ---------- */
  function sessions() {
    main.innerHTML = head('Recordings', 'Watch how real visitors moved through the site. Everything typed is masked.', '<button class="btn" id="ins-refresh" type="button">Refresh</button>') + tabs('sessions') +
      '<div class="bar"><input id="ins-q" type="search" placeholder="Search city, page, browser"><span id="ins-filters"></span><select id="ins-dev"><option value="">All devices</option><option>desktop</option><option>mobile</option><option>tablet</option></select><select id="ins-f"><option value="">All visitors</option><option value="popup">Opened the pop-up</option><option value="submit">Submitted</option><option value="booked">Booked</option><option value="long">Stayed over 1 minute</option></select></div>' +
      '<div class="card tablewrap"><table><thead><tr><th>When</th><th>Visitor</th><th>Device</th><th>Landed on</th><th class="num">Pages</th><th class="num">Time</th><th>Source</th><th>Pop-up</th><th></th></tr></thead><tbody id="ins-rows"></tbody></table><div class="empty" id="ins-empty" hidden>No recordings yet.</div></div>';
    $('ins-refresh').onclick = function () { SESS.loaded = false; loadSessions(); };
    $('ins-q').oninput = drawSessions; $('ins-dev').onchange = drawSessions; $('ins-f').onchange = drawSessions;
    loadSessions();
  }
  function loadSessions() {
    if (SESS.loaded) { $('ins-filters').innerHTML = filterSel(SESS.rows); wireFilters(drawSessions); return drawSessions(); }
    $('ins-rows').innerHTML = '<tr><td colspan="9" class="empty">Loading…</td></tr>';
    api({ view: 'sessions', limit: 1000 }).then(function (j) { SESS = { rows: j.rows || [], total: j.total || 0, loaded: true }; $('ins-filters').innerHTML = filterSel(SESS.rows); wireFilters(drawSessions); drawSessions(); }).catch(function (e) { $('ins-rows').innerHTML = ''; $('ins-empty').textContent = e.message; $('ins-empty').hidden = false; });
  }
  function drawSessions() {
    if (!$('ins-rows')) return;
    var q = ($('ins-q').value || '').toLowerCase(), dev = $('ins-dev').value, f = $('ins-f').value;
    var rows = applyFilter(SESS.rows).filter(function (s) {
      if (dev && s.device !== dev) return false;
      if (f === 'popup' && !s.popup) return false; if (f === 'submit' && !s.submit) return false; if (f === 'booked' && !s.booked) return false; if (f === 'long' && s.duration < 60) return false;
      if (q && [s.city, s.country, country(s.country), s.entry, s.source, s.ref, s.browser, s.os].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    $('ins-rows').innerHTML = rows.map(function (s) {
      var loc = [s.city, country(s.country)].filter(Boolean).join(', ') || 'Unknown location';
      var fun = s.booked ? '<span class="tag ok">✓ Booked a call</span>' : s.submit ? '<span class="tag">Submitted</span>' : s.popup ? '<span class="tag off">Opened</span>' : '';
      return '<tr data-id="' + esc(s.id) + '" class="' + (s.booked ? 'is-booked' : s.submit ? 'is-submit' : '') + '"><td><b>' + esc(ago(s.start)) + '</b><br><small style="color:#5d7280">' + esc(when(s.start)) + '</small></td><td>' + flag(s.country) + ' ' + esc(loc) + '</td><td>' + esc(s.device) + '<br><small style="color:#5d7280">' + esc(s.browser + (s.os ? ' · ' + s.os : '')) + '</small></td><td>' + esc(s.entry) + '</td><td class="num">' + s.pages + '</td><td class="num">' + dur(s.duration) + '</td><td>' + esc(srcLabel(s.source)) + (AI[s.source] ? ' <span class="tag">AI</span>' : '') + '</td><td>' + fun + '</td><td><span class="tag play">▶ Play</span></td></tr>';
    }).join('');
    $('ins-empty').hidden = rows.length > 0; $('ins-empty').textContent = SESS.rows.length ? 'No recordings match these filters.' : 'No recordings yet. They appear here a few minutes after visitors arrive.';
    [].forEach.call($('ins-rows').children, function (tr) { tr.onclick = function () { location.hash = '#insight/s/' + tr.dataset.id; }; });
  }

  /* ---------- Replay ---------- */
  function loadAsset(tag, src) {
    return new Promise(function (ok, fail) {
      var sel = tag === 'script' ? 'script[src="' + src + '"]' : 'link[href="' + src + '"]';
      if (document.querySelector(sel)) return ok();
      var el = document.createElement(tag); if (tag === 'script') el.src = src; else { el.rel = 'stylesheet'; el.href = src; }
      el.onload = ok; el.onerror = function () { fail(new Error('Could not load ' + src)); }; document.head.appendChild(el);
    });
  }
  function replay(id) {
    if (player) { try { player.pause(); } catch (e) {} player = null; }
    main.innerHTML = '<div class="ins-head"><div><a href="#insight/sessions" class="ins-back">← All recordings</a><h1 id="ins-title">Recording</h1><p class="sub" id="ins-sub">Loading…</p></div><div class="bar" style="margin:0"><button class="btn del" id="ins-del" type="button">Delete recording</button></div></div><div class="ins-replay"><div class="card ins-stage" id="ins-stage"><div class="empty" id="ins-progress">Loading recording…</div></div><div class="card ins-side"><h3>What happened</h3><ol class="ins-events" id="ins-events"></ol></div></div>';
    $('ins-del').onclick = function () { if (!confirm('Delete this recording for good?')) return; fetch('/api/admin/insight?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }).then(function () { SESS.loaded = false; location.hash = '#insight/sessions'; }); };
    var meta;
    api({ view: 'session', id: id }).then(function (s) {
      meta = s;
      var loc = [s.city, country(s.country)].filter(Boolean).join(', ');
      $('ins-title').textContent = (flag(s.country) + ' ' + (loc || 'Unknown location')).trim();
      $('ins-sub').textContent = when(s.start) + ' · ' + dur(s.duration) + ' · ' + s.pages + ' page' + (s.pages === 1 ? '' : 's') + ' · ' + s.device + ', ' + s.browser + (s.os ? ' on ' + s.os : '') + ' · ' + s.w + '×' + s.h + ' · from ' + srcLabel(s.source);
      return Promise.all([loadAsset('link', '/admin/vendor/rrweb-player.min.css'), loadAsset('script', '/admin/vendor/rrweb-player.min.js'), loadEvents(id, s.chunks)]);
    }).then(function (r) {
      var events = r[2];
      if (events.length < 2) { $('ins-progress').textContent = 'This recording has no replayable frames (the visitor left before the page finished loading).'; return; }
      $('ins-progress').remove();
      var stage = $('ins-stage'), w = Math.min(meta.w || 1280, stage.clientWidth - 2), scale = w / (meta.w || 1280), h = Math.max(300, Math.min(window.innerHeight - 250, Math.round((meta.h || 720) * scale)));
      var P = window.rrwebPlayer && (window.rrwebPlayer.default || window.rrwebPlayer.Player || window.rrwebPlayer);
      player = new P({ target: stage, props: { events: events, width: stage.clientWidth - 2, height: h, autoPlay: true, skipInactive: true, showController: true, speedOption: [1, 2, 4, 8], tags: { popup_open: '#0f7ac4', popup_submit: '#2e9e5b', booked: '#c0392b', pageview: '#8ea4b3', form_submit: '#2e9e5b' } } });
      var start = events[0].timestamp;
      var list = events.filter(function (e) { return e.type === 5 && e.data && e.data.tag !== 'field' && e.data.tag !== 'scroll_depth'; });
      $('ins-events').innerHTML = list.map(function (e, i) { var p = e.data.payload || {}, t = e.timestamp - start, text = e.data.tag === 'pageview' ? (p.title || p.path) + ' <small>' + esc(p.path) + '</small>' : e.data.tag === 'js_error' ? 'Page error: ' + esc(p.msg) : (TAG_LABELS[e.data.tag] || e.data.tag); return '<li data-t="' + t + '" class="' + esc(e.data.tag) + '"><span>' + dur(t / 1000) + '</span>' + text + '</li>'; }).join('');
      [].forEach.call($('ins-events').children, function (li) { li.onclick = function () { try { player.goto(+li.dataset.t, true); } catch (e) {} }; });
    }).catch(function (e) { var p = $('ins-progress'); if (p) p.textContent = e.message; });
  }
  function loadEvents(id, chunks) {
    var out = [], step = 20, i = 0;
    function next() {
      if (i >= chunks) { out.sort(function (a, b) { return a.timestamp - b.timestamp; }); return Promise.resolve(out); }
      var p = $('ins-progress'); if (p) p.textContent = 'Loading recording… ' + Math.round(i / chunks * 100) + '%';
      return api({ view: 'events', id: id, from: i, to: i + step - 1 }).then(function (j) { out = out.concat(j.events || []); i += step; return next(); });
    }
    return chunks ? next() : Promise.resolve(out);
  }

  /* ---------- Forms ---------- */
  function formsView() {
    main.innerHTML = head('Forms', 'Which fields visitors touch, fill in, and give up on.', rangeSel(RANGE)) + tabs('forms') + '<div id="ins-body"><div class="empty">Loading…</div></div>';
    $('ins-range').onchange = function () { RANGE = +this.value; formsView(); };
    api({ view: 'forms', days: RANGE }).then(function (j) {
      if (!j.forms.length) { $('ins-body').innerHTML = '<div class="card"><div class="empty">No form activity yet.</div></div>'; return; }
      $('ins-body').innerHTML = j.forms.map(function (F) {
        var fields = F.fields.slice();
        if (/pop-up/.test(F.form)) fields.sort(function (a, b) { return (POPUP_ORDER.indexOf(a.name) + 1 || 99) - (POPUP_ORDER.indexOf(b.name) + 1 || 99); });
        var max = Math.max(1, Math.max.apply(null, fields.map(function (f) { return f.focus; })));
        var started = fields.length ? Math.max.apply(null, fields.map(function (f) { return f.focus; })) : 0;
        return '<div class="card ins-table"><h3>' + esc(F.form) + '</h3><p class="sub" style="padding:0 16px">' + started + ' started · ' + F.submits + ' sent' + (F.abandoned ? ' · ' + F.abandoned + ' gave up' : '') + (/pop-up/.test(F.form) ? ' (sent = reached the calendar)' : '') + '</p><table><thead><tr><th>Field</th><th>Touched</th><th class="num">Filled in</th><th class="num">Gave up here</th></tr></thead><tbody>' +
          fields.map(function (f) { return '<tr><td>' + esc(label(f.name)) + '</td><td>' + barCell(f.focus, max) + '</td><td class="num">' + f.filled + ' <small style="color:#5d7280">(' + pct(f.filled, f.focus) + '%)</small></td><td class="num">' + (f.abandon ? '<span class="tag warn">' + f.abandon + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }).join('');
    }).catch(function (e) { $('ins-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  window.BH_INSIGHT = {
    nav: function () { return '<h4>Analytics</h4><a href="#insight">Overview</a><a href="#insight/pages">Pages</a><a href="#insight/sessions">Recordings</a><a href="#insight/forms">Forms</a>'; },
    route: function (parts, el) {
      main = el;
      if (player) { try { player.pause(); } catch (e) {} player = null; }
      var want = parts[0] === 'forms' ? '#insight/forms' : parts[0] === 'pages' ? '#insight/pages' : (parts[0] === 'sessions' || parts[0] === 's') ? '#insight/sessions' : '#insight';
      [].forEach.call(document.querySelectorAll('.side a'), function (a) { if (/^#insight/.test(a.getAttribute('href'))) a.classList.toggle('on', a.getAttribute('href') === want); });
      if (parts[0] === 'sessions') return sessions();
      if (parts[0] === 'forms') return formsView();
      if (parts[0] === 'pages') return pagesView();
      if (parts[0] === 's' && parts[1]) return replay(parts[1]);
      return overview();
    }
  };
})();
