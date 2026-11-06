// Admin "Pipeline": every lead (website forms + the Lead Entry sheets) and every meeting (Calendly + the
// sheets' appointments) in one place, with one-click Showed / No-show / Rescheduled / Cancelled.
// Team members (callers) see only their own leads and appointments, read-only.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var DATA = null, MAIN = null, SUB = '', VIEW = '', LOADING = null;
  var F = { range: 30, type: '', campaign: '', caller: '', stage: '', q: '', mtab: '' };
  var STAGE = { new: ['New', 'st-new'], working: ['Working', 'st-work'], booked: ['Meeting booked', 'st-booked'], needs: ['Needs marking', 'st-needs'], showed: ['Showed', 'st-showed'], no_show: ['No-show', 'st-noshow'], cancelled: ['Cancelled', 'st-off'], won: ['Won', 'st-won'], lost: ['Lost', 'st-off'] };
  var OUT = { upcoming: ['Upcoming', 'st-booked'], needs: ['Needs marking', 'st-needs'], showed: ['Showed', 'st-showed'], no_show: ['No-show', 'st-noshow'], rescheduled: ['Rescheduled', 'st-off'], cancelled: ['Cancelled', 'st-off'] };
  var BTNS = [['showed', 'Showed'], ['no_show', 'No-show'], ['rescheduled', 'Rescheduled'], ['cancelled', 'Cancelled']];

  function api(method, payload, qs) {
    return fetch('/api/admin/pipeline' + (qs || ''), { method: method, credentials: 'same-origin', cache: 'no-store', headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401) { location.reload(); throw new Error('Signed out'); } if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }); });
  }
  function load(sync) { LOADING = api('GET', null, sync === false ? '?sync=0' : '').then(function (j) { DATA = j; LOADING = null; return j; }, function (e) { LOADING = null; throw e; }); return LOADING; }
  function t(v) { var x = typeof v === 'number' ? v : Date.parse(v); return isNaN(x) ? 0 : x; }
  function day(ts) { if (!ts) return '—'; var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
  function when(ts) { if (!ts) return '—'; var d = new Date(ts); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function ago(ts) { if (!ts) return 'never'; var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; var h = Math.round(m / 60); if (h < 24) return h + ' h ago'; var d = Math.round(h / 24); return d + ' day' + (d > 1 ? 's' : '') + ' ago'; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function tag(map, k) { var s = map[k] || [k, 'st-off']; return '<span class="st ' + s[1] + '">' + esc(s[0]) + '</span>'; }
  function typeTag(ty) { return '<span class="ty ty-' + (ty === 'outbound' ? 'out' : 'in') + '">' + (ty === 'outbound' ? 'Outbound' : 'Inbound') + '</span>'; }
  function seqTag(m) { return m.seq > 1 ? '<span class="pl-seq">Follow-up · meeting ' + m.seq + '</span>' : m.seq === 1 ? '<span class="pl-seq pl-seq1">1st meeting</span>' : ''; }
  function isAdmin() { return DATA && DATA.role === 'admin'; }
  function campaignOf(l) { return (l.campaigns || [])[0] || ''; }
  function inRange(ts) { return !F.range || t(ts) >= Date.now() - F.range * 864e5; }
  function leadByKey(k) { return DATA.leads.find(function (l) { return l.key === k; }); }
  function opts(list, cur, all) { return '<option value="">' + esc(all) + '</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function uniq(arr) { var s = {}; arr.forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(); }
  function matchesLead(l) {
    if (F.type && l.type !== F.type) return false;
    if (F.campaign && (l.campaigns || []).indexOf(F.campaign) < 0) return false;
    if (F.caller && (l.callers || []).indexOf(F.caller) < 0) return false;
    return true;
  }
  function matchesMeeting(m) {
    if (F.type && m.type !== F.type) return false;
    if (F.campaign && (m.campaigns || []).indexOf(F.campaign) < 0) return false;
    if (F.caller && (m.callers || []).indexOf(F.caller) < 0) return false;
    return true;
  }

  function head() {
    var s = DATA.status, c = s.calendly, sh = s.sheets;
    var line = (c.connected ? 'Calendly synced ' + ago(c.lastSync) : 'Calendly not connected') + ' · ' + (sh.files.length ? 'Sheets synced ' + ago(sh.lastSync) : 'Sheets not connected') + ' · ' + (s.fathom && s.fathom.connected ? 'Fathom synced ' + ago(s.fathom.lastSync) : 'Fathom not connected') + (isAdmin() ? ' · Website forms live' : '');
    var needs = DATA.meetings.filter(function (m) { return m.outcome === 'needs'; }).length;
    var sub = isAdmin() ? 'Every inbound and outbound lead, and every meeting.' : 'Your leads and appointments' + (DATA.me ? ', ' + esc(DATA.me.name) : '') + '.';
    var tabs = [['', 'Dashboard', ''], ['leads', 'Leads', DATA.leads.length], ['meetings', 'Meetings', needs ? needs + (isAdmin() ? ' to mark' : ' not marked') : '']];
    if (isAdmin()) tabs.push(['sources', 'Sources', ''], ['team', 'Team access', (DATA.team || []).length || '']);
    return '<div class="ins-head"><div><h1>Pipeline</h1><p class="sub">' + sub + ' <span class="pl-sync">' + esc(line) + '</span></p></div><div class="bar" style="margin:0"><button class="btn" id="pl-refresh" type="button">Refresh</button></div></div>' +
      (isAdmin() ? setup() : '') +
      '<div class="tabs">' + tabs.map(function (x) { return '<a class="tab' + (SUB === x[0] || (SUB === 'view' && !x[0]) ? ' on' : '') + '" href="#pipeline' + (x[0] ? '/' + x[0] : '') + '">' + x[1] + (x[2] !== '' ? '<b>' + esc(x[2]) + '</b>' : '') + '</a>'; }).join('') + '</div>';
  }
  function setup() {
    var s = DATA.status, bits = [];
    if (s.fathom && !s.fathom.connected) bits.push('<li><b>Fathom:</b> not connected yet. Add your Fathom API key as <code>FATHOM_API_KEY</code> in Vercel to attach call recordings and summaries to leads.</li>');
    else if (s.fathom && s.fathom.error) bits.push('<li><b>Fathom:</b> last sync failed: ' + esc(s.fathom.error) + '</li>');
    if (!s.calendly.connected) bits.push('<li><b>Calendly:</b> not connected yet. Add your Calendly key as <code>CALENDLY_TOKEN</code> in Vercel (Settings → Environment Variables), then redeploy.</li>');
    else if (s.calendly.error) bits.push('<li><b>Calendly:</b> last sync failed: ' + esc(s.calendly.error) + '</li>');
    if (!s.sheets.files.length) bits.push('<li><b>Lead Entry sheets:</b> not connected yet. The "BPO Hive Pipeline sync" Google script sends the sheets listed under <a href="#pipeline/sources">Sources</a> every 15 minutes once it is switched on.</li>');
    s.sheets.files.forEach(function (f) { if (f.error) bits.push('<li><b>' + esc(f.name || f.title) + ':</b> could not be read (' + esc(f.error) + '). Make sure amr@bpohive.com can open this sheet.</li>'); });
    if (s.calendly.connected && !s.calendly.backfilled) bits.push('<li><b>Calendly:</b> still loading past meetings. Refresh in a minute.</li>');
    return bits.length ? '<div class="note"><ul style="margin:0;padding-left:18px">' + bits.join('') + '</ul></div>' : '';
  }
  function filters(withRange, withStage) {
    var camps = uniq([].concat.apply([], DATA.leads.map(function (l) { return l.campaigns || []; })));
    var callers = uniq([].concat.apply([], DATA.leads.map(function (l) { return l.callers || []; })));
    return '<div class="bar">' +
      (withRange ? '<select id="pl-range">' + [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']].map(function (r) { return '<option value="' + r[0] + '"' + (F.range === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' : '<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">') +
      '<select id="pl-type"><option value="">Inbound + outbound</option><option value="inbound"' + (F.type === 'inbound' ? ' selected' : '') + '>Inbound only</option><option value="outbound"' + (F.type === 'outbound' ? ' selected' : '') + '>Outbound only</option></select>' +
      '<select id="pl-campaign">' + opts(camps, F.campaign, 'All campaigns') + '</select>' +
      (isAdmin() ? '<select id="pl-caller">' + opts(callers, F.caller, 'All callers') + '</select>' : '') +
      (withStage ? '<select id="pl-stage">' + '<option value="">Every stage</option>' + Object.keys(STAGE).map(function (k) { return '<option value="' + k + '"' + (F.stage === k ? ' selected' : '') + '>' + STAGE[k][0] + '</option>'; }).join('') + '</select>' : '') +
      '</div>';
  }
  function bindFilters() {
    [['pl-range', 'range', true], ['pl-type', 'type'], ['pl-campaign', 'campaign'], ['pl-caller', 'caller'], ['pl-stage', 'stage']].forEach(function (x) { var el = $(x[0]); if (el) el.onchange = function () { F[x[1]] = x[2] ? +el.value : el.value; draw(); }; });
    var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; drawLeadsTable(); };
    var rf = $('pl-refresh'); if (rf) rf.onclick = function () { rf.disabled = true; rf.textContent = 'Syncing…'; (isAdmin() ? api('POST', { action: 'sync' }).catch(function () {}) : Promise.resolve()).then(function () { return load(isAdmin() ? false : true); }).then(draw).catch(fail); };
  }

  /* ---------- Dashboard ---------- */
  function weekly(items, getTs, groups, weeks) {
    var start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
    var cols = []; for (var i = 0; i < weeks; i++) { var d = new Date(start); d.setDate(d.getDate() + i * 7); cols.push({ from: +d, to: +d + 7 * 864e5, n: {} }); }
    items.forEach(function (x) { var ts = getTs(x); cols.forEach(function (c) { if (ts >= c.from && ts < c.to) { var g = groups(x); c.n[g] = (c.n[g] || 0) + 1; } }); });
    return cols;
  }
  function bars(cols, series, title) {
    var W = 720, H = 200, pad = 28, bw = (W - pad * 2) / cols.length;
    var max = Math.max(1, Math.max.apply(null, cols.map(function (c) { return series.reduce(function (s, x) { return s + (c.n[x[0]] || 0); }, 0); })));
    var svg = '<svg class="ins-svg" viewBox="0 0 ' + W + ' ' + (H + 26) + '" role="img" aria-label="' + esc(title) + '">';
    [0, .5, 1].forEach(function (g) { var y = H - g * (H - 10); svg += '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y + '" y2="' + y + '" stroke="#edf3f7"/><text x="' + (pad - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#8a9aa6">' + Math.round(max * g) + '</text>'; });
    cols.forEach(function (c, i) {
      var x = pad + i * bw + bw * .18, w = bw * .64, y = H;
      series.forEach(function (s) { var v = c.n[s[0]] || 0; if (!v) return; var h = v / max * (H - 10); y -= h; svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + s[2] + '"><title>' + esc(s[1]) + ': ' + v + '</title></rect>'; });
      if (i % 2 === 0 || cols.length <= 8) svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H + 16) + '" text-anchor="middle" font-size="11" fill="#8a9aa6">' + new Date(c.from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</text>';
    });
    svg += '</svg>';
    return '<div class="card ins-chart"><h3>' + esc(title) + '</h3><div class="ins-scroll">' + svg + '</div><div class="ins-legend">' + series.map(function (s) { return '<span><i style="background:' + s[2] + '"></i>' + esc(s[1]) + '</span>'; }).join('') + '</div></div>';
  }
  function breakdown(title, keyName, rowsOf) {
    var map = {};
    DATA.leads.filter(matchesLead).forEach(function (l) { rowsOf(l).forEach(function (k) { var r = map[k] || (map[k] = { k: k, leads: 0, booked: 0, showed: 0, noshow: 0 }); if (inRange(l.firstAt)) r.leads++; }); });
    DATA.meetings.filter(matchesMeeting).forEach(function (m) {
      if (!inRange(m.created)) return; var l = m.leadKey ? leadByKey(m.leadKey) : null; var keys = l ? rowsOf(l) : [];
      keys.forEach(function (k) { var r = map[k] || (map[k] = { k: k, leads: 0, booked: 0, showed: 0, noshow: 0 }); r.booked++; if (m.outcome === 'showed') r.showed++; if (m.outcome === 'no_show') r.noshow++; });
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; }).filter(function (r) { return r.leads || r.booked; }).sort(function (a, b) { return b.booked - a.booked || b.leads - a.leads; });
    return '<div class="card ins-table tablewrap"><h3>' + esc(title) + '</h3>' + (rows.length ? '<table><thead><tr><th>' + esc(keyName) + '</th><th class="num">New leads</th><th class="num">Meetings booked</th><th class="num">Showed</th><th class="num">No-show</th><th class="num">Show rate</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.k) + '</td><td class="num">' + r.leads + '</td><td class="num">' + r.booked + '</td><td class="num">' + r.showed + '</td><td class="num">' + r.noshow + '</td><td class="num">' + (r.showed + r.noshow ? pct(r.showed, r.showed + r.noshow) + '%' : '—') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Nothing in this period yet.</div>') + '</div>';
  }
  // What each dashboard box counts. The "View" pages list exactly these, with the same filters.
  function sets() {
    var leads = DATA.leads.filter(matchesLead).filter(function (l) { return inRange(l.firstAt); });
    var ms = DATA.meetings.filter(matchesMeeting);
    var booked = ms.filter(function (m) { return inRange(m.created); }).sort(function (a, b) { return t(b.created) - t(a.created); });
    var held = ms.filter(function (m) { return inRange(m.start) && t(m.start) < Date.now() && ['showed', 'no_show', 'needs'].indexOf(m.outcome) > -1; });
    var is = function (o) { return function (m) { return m.outcome === o; }; };
    return {
      leads: leads, ms: ms, booked: booked, held: held,
      inbound: leads.filter(function (l) { return l.type === 'inbound'; }), outbound: leads.filter(function (l) { return l.type !== 'inbound'; }),
      first: booked.filter(function (m) { return !(m.seq > 1); }), followups: booked.filter(function (m) { return m.seq > 1; }),
      showed: held.filter(is('showed')), noshow: held.filter(is('no_show')), marked: held.filter(function (m) { return m.outcome !== 'needs'; }),
      needs: ms.filter(is('needs')), won: DATA.leads.filter(matchesLead).filter(function (l) { return l.stage === 'won'; })
    };
  }
  var VIEWS = {
    leads: ['New leads', 'leads', 'leads', 'Every lead that came in during this period.'],
    inbound: ['Inbound leads', 'leads', 'inbound', 'Came in through the website: a form, or a call booked on bpohive.com.'],
    outbound: ['Outbound leads', 'leads', 'outbound', 'Came from the Lead Entry sheets or booked through a Calendly link the team sent.'],
    booked: ['Meetings booked', 'meetings', 'booked', 'Meetings booked during this period, newest booking first.'],
    first: ['First meetings booked', 'meetings', 'first', 'The first meeting with each lead, booked during this period (including ones later cancelled or moved).'],
    followups: ['Follow-up meetings booked', 'meetings', 'followups', 'Second, third… meetings with leads who already met us.'],
    showed: ['Showed', 'meetings', 'showed', 'Meetings in this period the prospect showed up to.'],
    noshow: ['No-shows', 'meetings', 'noshow', 'Meetings in this period the prospect missed.'],
    rate: ['Marked meetings', 'meetings', 'marked', 'The meetings the show rate is worked out from (showed + no-show).'],
    needs: ['Needs marking', 'meetings', 'needs', 'These meetings already happened. Mark each one so the show rate stays right.'],
    won: ['Won', 'leads', 'won', 'Leads marked as won (became a client).']
  };
  function viewLink(k, label) { return '<a class="pl-view" href="#pipeline/view/' + k + '">' + (label || 'View') + ' →</a>'; }
  function dashboard() {
    var S = sets(), showed = S.showed.length, noshow = S.noshow.length, needs = S.needs.length;
    var sub = function (k, n, label) { return n ? '<a href="#pipeline/view/' + k + '">' + n + ' ' + label + '</a>' : '0 ' + label; };
    var tiles = [
      ['New leads', S.leads.length, sub('inbound', S.inbound.length, 'inbound') + ' · ' + sub('outbound', S.outbound.length, 'outbound'), 'leads'],
      ['Meetings booked', S.booked.length, sub('first', S.first.length, 'first') + ' · ' + sub('followups', S.followups.length, 'follow-up' + (S.followups.length === 1 ? '' : 's')), 'booked'],
      ['Showed', showed, esc('of ' + S.held.length + ' held'), 'showed'],
      ['No-show', noshow, '', 'noshow'],
      ['Show rate', showed + noshow ? pct(showed, showed + noshow) + '%' : '—', 'of marked meetings', 'rate'],
      ['Needs marking', needs, needs ? 'not marked yet' : 'all caught up', 'needs'],
      ['Won', S.won.length, 'all time', 'won']
    ];
    var ms = S.ms;
    var upcoming = ms.filter(function (m) { return m.outcome === 'upcoming' && t(m.start) < Date.now() + 7 * 864e5; }).sort(function (a, b) { return t(a.start) - t(b.start); });
    var weeks = 12;
    var lc = weekly(DATA.leads.filter(matchesLead), function (l) { return l.firstAt; }, function (l) { return l.type; }, weeks);
    var mc = weekly(ms.filter(function (m) { return t(m.start) < Date.now(); }), function (m) { return t(m.start); }, function (m) { return m.outcome; }, weeks);
    return filters(true, false) +
      '<div class="ins-tiles">' + tiles.map(function (x) { return '<div class="ins-tile pl-tile"><small>' + x[0] + '</small><b>' + x[1] + '</b><span>' + x[2] + '</span>' + viewLink(x[3]) + '</div>'; }).join('') + '</div>' +
      '<div class="ins-grid">' + bars(lc, [['inbound', 'Inbound', '#0f7ac4'], ['outbound', 'Outbound', '#1B7381']], 'New leads per week') +
      bars(mc, [['showed', 'Showed', '#1e7a43'], ['no_show', 'No-show', '#c0392b'], ['needs', 'Not marked yet', '#e0a526'], ['rescheduled', 'Rescheduled', '#9fb2bf'], ['cancelled', 'Cancelled', '#cfd9e0']], 'Meetings per week') + '</div>' +
      '<div class="card ins-table" style="margin-bottom:14px"><h3>Next 7 days</h3>' + (upcoming.length ? meetingTable(upcoming, true) : '<div class="empty">No meetings booked for the next 7 days.</div>') + '</div>' +
      breakdown('By campaign', 'Campaign', function (l) { return (l.campaigns || []).length ? l.campaigns : [l.type === 'inbound' ? 'Booked on the website' : 'Calendly link from the team']; }) +
      '<div style="height:14px"></div>' + breakdown('By caller', 'Caller', function (l) { return (l.callers || []).length ? l.callers : [l.type === 'inbound' ? 'Inbound (no caller)' : 'Unassigned']; });
  }

  /* ---------- View (the list behind a dashboard box) ---------- */
  function viewPage() {
    var v = VIEWS[VIEW] || VIEWS.leads, rows = sets()[v[2]] || [];
    var fb = filters(true, false); if (VIEW === 'needs' || VIEW === 'won') fb = fb.replace(/<select id="pl-range">[\s\S]*?<\/select>/, '');
    var list = v[1] === 'leads' ? '<div class="card tablewrap pl-table" id="pl-leads">' + (rows.length ? leadTable(rows.slice(0, 500)) : '<div class="empty">Nothing here for this period.</div>') + '</div>'
      : '<div class="card tablewrap pl-table" id="pl-meetings">' + (rows.length ? meetingTable(rows.slice(0, 500), false) : '<div class="empty">Nothing here for this period.</div>') + '</div>';
    var more = { leads: [['inbound', 'Inbound only'], ['outbound', 'Outbound only']], inbound: [['leads', 'All new leads'], ['outbound', 'Outbound']], outbound: [['leads', 'All new leads'], ['inbound', 'Inbound']], booked: [['first', 'First meetings'], ['followups', 'Follow-ups']], first: [['booked', 'All booked'], ['followups', 'Follow-ups']], followups: [['booked', 'All booked'], ['first', 'First meetings']] }[VIEW] || [];
    return '<p class="pl-back"><a href="#pipeline">← Dashboard</a></p><div class="pl-vhead"><h2>' + esc(v[0]) + ' <span>' + rows.length + '</span></h2>' + (more.length ? '<div class="pl-vlinks">' + more.map(function (x) { return '<a href="#pipeline/view/' + x[0] + '">' + esc(x[1]) + '</a>'; }).join('') + '</div>' : '') + '</div>' +
      '<p class="ins-note" style="margin:-2px 0 10px">' + esc(v[3]) + '</p>' + fb + list + (rows.length > 500 ? '<p class="ins-note">Showing the first 500 of ' + rows.length + '.</p>' : '');
  }

  /* ---------- Leads ---------- */
  function leadRows() {
    var q = F.q.trim().toLowerCase();
    return DATA.leads.filter(matchesLead).filter(function (l) {
      if (F.stage && l.stage !== F.stage) return false;
      return !q || [l.name, l.company, l.email, l.title, l.latest].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function leadTable(shown) {
    return '<table><thead><tr><th>Came in</th><th>Lead</th><th>Type</th><th>Campaign · caller</th><th>Stage</th><th>Latest</th><th>Meeting</th></tr></thead><tbody>' + shown.map(function (l) {
      var n = (l.meetings || []).length;
      var meet = l.next ? 'Next: ' + when(l.next) : (l.lastMeeting ? day(l.lastMeeting.start) + ' · ' + (OUT[l.lastMeeting.outcome] || [''])[0] : '—');
      return '<tr data-k="' + esc(l.key) + '"><td>' + day(l.firstAt) + '</td><td><b>' + esc(l.name || l.email || '(no name)') + '</b><br><small>' + esc([l.title, l.company].filter(Boolean).join(' · ')) + '</small></td><td>' + typeTag(l.type) + (l.origin ? '<br><small>' + esc(l.origin) + '</small>' : '') + '</td><td>' + esc(campaignOf(l) || '—') + (l.callers.length ? '<br><small>' + esc(l.callers.join(', ')) + '</small>' : '') + '</td><td>' + tag(STAGE, l.stage) + '</td><td class="pl-latest">' + esc(l.latest || '') + '</td><td><small>' + esc(meet) + (n > 1 ? '<br>' + n + ' meetings' : '') + '</small></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function bindLeadRows(el) { [].forEach.call(el.querySelectorAll('tbody tr[data-k]'), function (tr) { tr.onclick = function () { openLead(tr.getAttribute('data-k')); }; }); }
  function drawLeadsTable() {
    var rows = leadRows(), shown = rows.slice(0, 400);
    var el = $('pl-leads'); if (!el) return;
    el.innerHTML = rows.length ? leadTable(shown) + (rows.length > shown.length ? '<p class="ins-note" style="padding:0 16px 12px">Showing the newest 400 of ' + rows.length + '. Search or filter to narrow it down.</p>' : '') : '<div class="empty">No leads match.</div>';
    $('pl-count').textContent = rows.length + ' lead' + (rows.length === 1 ? '' : 's');
    bindLeadRows(el);
  }
  function leadsView() { return filters(false, true) + '<p class="ins-note" id="pl-count" style="margin:-4px 0 10px"></p><div class="card tablewrap pl-table" id="pl-leads"></div>'; }

  /* ---------- Meetings ---------- */
  function outcomeButtons(m) {
    if (!isAdmin()) return '';
    if (m.outcome === 'upcoming') return '<div class="pl-outs">' + BTNS.slice(2).map(function (b) { return '<button type="button" class="mini" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>';
    return '<div class="pl-outs">' + BTNS.map(function (b) { return '<button type="button" class="mini pl-o-' + b[0] + (m.outcome === b[0] ? ' on' : '') + '" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + (!m.auto ? '<button type="button" class="mini pl-undo" data-m="' + esc(m.id) + '" data-o="clear" title="Go back to what Calendly or the sheet says">Undo</button>' : '') + '</div>';
  }
  function meetingTable(rows, compact) {
    return '<table><thead><tr><th>When</th><th>Who</th><th>Type</th><th>Meeting</th><th>' + (compact ? 'Status' : 'Outcome') + '</th></tr></thead><tbody>' + rows.map(function (m) {
      var who = m.invitee.name || m.invitee.email || '(unknown)';
      return '<tr class="pl-m-' + m.outcome + '" data-k="' + esc(m.leadKey || '') + '"><td class="pl-when">' + when(m.start) + '</td><td><b>' + esc(who) + '</b><br><small>' + esc([m.company, m.invitee.email].filter(Boolean).join(' · ')) + '</small></td><td>' + typeTag(m.type) + (m.callers.length ? '<br><small>' + esc(m.callers.join(', ')) + '</small>' : '') + '</td><td>' + esc(m.name) + (seqTag(m) ? ' ' + seqTag(m) : '') + (m.host ? '<br><small>with ' + esc(m.host) + '</small>' : '') + (m.sheet ? '<br><small>' + esc(m.sheet.source) + (m.sheet.confirm ? ' · ' + esc(m.sheet.confirm) : '') + '</small>' : '') + (m.sheet && m.sheet.recording ? '<br><a class="pl-rec" href="' + esc(m.sheet.recording) + '" target="_blank" rel="noopener">▶ Booking call</a>' : '') + (m.fathom && m.fathom.url ? '<br><a class="pl-rec" href="' + esc(m.fathom.url) + '" target="_blank" rel="noopener">▶ Fathom recording</a>' : '') + '</td><td>' + tag(OUT, m.outcome) + (m.viaFathom ? ' <small class="pl-via">from Fathom</small>' : '') + (m.viaSheet ? ' <small class="pl-via">from sheet</small>' : '') + (compact ? '' : outcomeButtons(m)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function meetingsView() {
    var ms = DATA.meetings.filter(matchesMeeting), now = Date.now();
    var groups = { needs: ms.filter(function (m) { return m.outcome === 'needs'; }), upcoming: ms.filter(function (m) { return m.outcome === 'upcoming'; }).sort(function (a, b) { return t(a.start) - t(b.start); }), past: ms.filter(function (m) { return t(m.start) < now && m.outcome !== 'needs'; }), all: ms };
    if (!F.mtab) F.mtab = groups.needs.length ? 'needs' : 'upcoming';
    var rows = groups[F.mtab] || [];
    return filters(false, false).replace('<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">', '') +
      '<div class="tabs pl-mtabs">' + [['needs', 'Needs marking'], ['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(function (x) { return '<button type="button" class="tab' + (F.mtab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '">' + x[1] + '<b>' + groups[x[0]].length + '</b></button>'; }).join('') + '</div>' +
      (F.mtab === 'needs' && rows.length && isAdmin() ? '<p class="ins-note" style="margin:-4px 0 10px">These meetings already happened. Mark each one (or fill in Show Status in the sheet) so the show rate stays right. A no-show on a Calendly meeting is also flagged in Calendly.</p>' : '') +
      '<div class="card tablewrap pl-table" id="pl-meetings">' + (rows.length ? meetingTable(rows.slice(0, 500), false) : '<div class="empty">' + (F.mtab === 'needs' ? 'All caught up. Every past meeting is marked.' : 'No meetings here.') + '</div>') + '</div>';
  }
  function bindMeetings(root) {
    [].forEach.call(root.querySelectorAll('.pl-mtabs .tab'), function (b) { b.onclick = function () { F.mtab = b.getAttribute('data-t'); draw(); }; });
    [].forEach.call(root.querySelectorAll('button[data-o]'), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation(); var id = b.getAttribute('data-m'), o = b.getAttribute('data-o');
        [].forEach.call(b.parentNode.querySelectorAll('button'), function (x) { x.disabled = true; });
        api('POST', { action: 'outcome', id: id, outcome: o }).then(function () { return load(false); }).then(draw).catch(fail);
      };
    });
    [].forEach.call(root.querySelectorAll('tr[data-k]'), function (tr) { tr.onclick = function () { var k = tr.getAttribute('data-k'); if (k) openLead(k); }; });
  }

  /* ---------- Lead detail ---------- */
  function dlg() {
    var d = $('pl-dialog');
    if (!d) { d = document.createElement('dialog'); d.id = 'pl-dialog'; d.className = 'pl-dialog'; document.body.appendChild(d); d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); }
    return d;
  }
  function openLead(key) {
    var l = leadByKey(key); if (!l) return;
    var ms = l.meetings.map(function (id) { return DATA.meetings.find(function (m) { return m.id === id; }); }).filter(Boolean);
    var row = function (k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>' : ''; };
    var trail = l.sheetRows.map(function (r) { var facts = [r.vertical && 'Vertical: ' + r.vertical, r.appt && 'Appointment: ' + when(r.appt), r.confirm && 'Confirmation: ' + r.confirm, r.followup && 'Follow-up: ' + r.followup, r.show && 'Show status: ' + r.show, r.location && 'Location: ' + r.location].filter(Boolean); return '<div class="pl-trail"><small>' + esc(r.sheet) + (r.caller ? ' · ' + esc(r.caller) : '') + (r.at ? ' · entered ' + esc(r.at) : '') + '</small>' + (facts.length ? '<pre>' + esc(facts.join('\n')) + '</pre>' : '') + (r.trail || r.update ? '<pre class="pl-notes">' + esc(r.trail || r.update) + '</pre>' : '') + (r.recording ? '<a class="pl-rec" href="' + esc(r.recording) + '" target="_blank" rel="noopener">▶ Booking call recording</a>' : '') + '</div>'; }).join('');
    var recs = (l.recordings || []).map(function (r) { return '<div class="pl-trail"><small>' + when(r.start) + (r.recordedBy ? ' · recorded by ' + esc(r.recordedBy) : '') + (r.spoke ? '' : ' · prospect did not speak') + '</small><div class="pl-rec-h"><b>' + esc(r.title || 'Call') + '</b>' + (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">▶ Watch in Fathom</a>' : '') + '</div>' + (r.summary ? '<details><summary>Summary</summary><pre>' + esc(r.summary.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')) + '</pre></details>' : '') + (r.actions && r.actions.length ? '<details><summary>Action items (' + r.actions.length + ')</summary><pre>' + esc(r.actions.map(function (a) { return '• ' + a; }).join('\n')) + '</pre></details>' : '') + '</div>'; }).join('');
    var forms = l.website.map(function (w) { return '<div class="pl-trail"><small>' + esc(w.form) + ' · ' + when(w.at) + (w.page ? ' · ' + esc(String(w.page).replace(/^https?:\/\/[^/]+/, '')) : '') + '</small><pre>' + esc(Object.keys(w.fields || {}).filter(function (k) { return !/^(eventId|button|cta|draftId)$/.test(k); }).map(function (k) { return k + ': ' + w.fields[k]; }).join('\n')) + '</pre></div>'; }).join('');
    var d = dlg();
    d.innerHTML = '<div class="dl"><button class="x" type="button" aria-label="Close">×</button><h2>' + esc(l.name || l.email) + '</h2><div style="color:#5d7280">' + esc([l.title, l.company].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="pl-dtags">' + typeTag(l.type) + tag(STAGE, l.stage) + '</div>' +
      '<dl>' + row('Email', l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '') + row('Phone', esc(l.phone)) + row('Came in', when(l.firstAt)) + row('How', esc(l.origin)) + row('Campaign', esc(l.campaigns.join(', '))) + row('Caller', esc(l.callers.join(', '))) + row('Latest', esc(l.latest)) + '</dl>' +
      (ms.length ? '<h3 class="pl-h">Meetings</h3><div class="pl-table">' + meetingTable(ms, false) + '</div>' : '') +
      (recs ? '<h3 class="pl-h">Recorded calls (Fathom)</h3>' + recs : '') + (trail ? '<h3 class="pl-h">From the Lead Entry sheet</h3>' + trail : '') + (forms ? '<h3 class="pl-h">Website forms</h3>' + forms : '') +
      (isAdmin() ? '<h3 class="pl-h">Your update</h3><div class="pl-edit"><label>Stage<select id="pl-d-stage"><option value="">Automatic</option><option value="won"' + (l.stageOverride === 'won' ? ' selected' : '') + '>Won (became a client)</option><option value="lost"' + (l.stageOverride === 'lost' ? ' selected' : '') + '>Lost</option></select></label>' +
      '<label>Type<select id="pl-d-type"><option value="">Automatic</option><option value="inbound"' + (l.typeOverride === 'inbound' ? ' selected' : '') + '>Inbound</option><option value="outbound"' + (l.typeOverride === 'outbound' ? ' selected' : '') + '>Outbound</option></select></label>' +
      '<label class="pl-note">Notes<textarea id="pl-d-note" rows="3" placeholder="Anything the team should know">' + esc(l.note) + '</textarea></label></div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="btn pri" id="pl-d-save" type="button">Save</button><span id="pl-d-msg" style="color:#5d7280;font-size:14px"></span></div>' : '') + '</div>';
    d.querySelector('.x').onclick = function () { d.close(); };
    bindMeetings(d);
    [].forEach.call(d.querySelectorAll('tr[data-k]'), function (tr) { tr.onclick = null; });
    if ($('pl-d-save')) $('pl-d-save').onclick = function () {
      var b = this; b.disabled = true; $('pl-d-msg').textContent = 'Saving…';
      api('POST', { action: 'lead', key: l.key, stage: $('pl-d-stage').value, type: $('pl-d-type').value, note: $('pl-d-note').value }).then(function () { return load(false); }).then(function () { $('pl-d-msg').textContent = 'Saved'; draw(); setTimeout(function () { if (d.open) openLead(key); }, 300); }).catch(function (e) { $('pl-d-msg').textContent = e.message; }).then(function () { b.disabled = false; });
    };
    if (!d.open) d.showModal();
  }


  /* ---------- Sources (admin) ---------- */
  var SRC_EDIT = null;
  function sheetUrl(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }
  function sourcesView() {
    if (!SRC_EDIT) SRC_EDIT = (DATA.sources || []).map(function (x) { return { name: x.name, url: sheetUrl(x.id), tz: x.tz, id: x.id }; });
    var files = {}; (DATA.status.sheets.files || []).forEach(function (f) { files[f.id || ''] = f; });
    var tzOpts = function (cur) { return (DATA.timezones || []).map(function (z) { return '<option value="' + z + '"' + (z === cur ? ' selected' : '') + '>' + z.replace('_', ' ') + '</option>'; }).join(''); };
    return '<p class="sub" style="margin-top:-6px">The Lead Entry sheets the Pipeline reads. Paste a new link here if a sheet changes. The sheet must be one amr@bpohive.com can open. Changes are picked up on the next sync (every 15 minutes).</p>' +
      '<div class="card pl-src">' + SRC_EDIT.map(function (x, i) {
        var f = x.id ? files[x.id] : null;
        return '<div class="pl-src-row" data-i="' + i + '"><label>Name<input type="text" data-f="name" value="' + esc(x.name) + '" placeholder="BPO Hive USA"></label><label class="pl-src-url">Google Sheet link<input type="text" data-f="url" value="' + esc(x.url) + '" placeholder="https://docs.google.com/spreadsheets/d/…"></label><label>Time zone for appointment times<select data-f="tz">' + tzOpts(x.tz) + '</select></label><div class="pl-src-act">' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">Open ↗</a>' : '') + '<button type="button" class="mini" data-del="' + i + '">Remove</button></div>' +
          '<small class="pl-src-st">' + (f ? (f.error ? '⚠ ' + esc(f.error) : f.rows + ' rows · synced ' + ago(f.syncedAt)) : 'Not synced yet') + '</small></div>';
      }).join('') + '<div class="pl-src-foot"><button type="button" class="btn" id="pl-src-add">+ Add a sheet</button><button type="button" class="btn pri" id="pl-src-save">Save sources</button><span id="pl-src-msg" class="ins-note" style="margin:0"></span></div></div>' +
      eventTypesCard() +
      '<p class="ins-note">Columns are found by their names (Prospect Name, Business Name, Agent Name, Appointment Date, Appointment Time, Timezone, Prospect Email, Call Recording Link, Confirmation Status, Show Status…), so you can add or move columns. If a row has its own Timezone (EST, GST…), that wins over the time zone above.</p>';
  }
  function eventTypesCard() {
    var list = (DATA.status.calendly && DATA.status.calendly.eventTypes) || [];
    if (!list.length) return '';
    return '<h3 class="pl-h" style="margin-top:22px">Calendly event types</h3><p class="sub" style="margin-top:-4px">Untick the ones that are not sales calls (job interviews, vendor calls…). They are left out of leads, meetings and the show rate.</p>' +
      '<div class="card pl-ev">' + list.map(function (e) { return '<label class="pl-ev-row"><input type="checkbox" data-ev="' + esc(e.name) + '"' + (e.skipped ? '' : ' checked') + '> <span>' + esc(e.name || '(no name)') + '</span><small>' + e.meetings + ' meeting' + (e.meetings === 1 ? '' : 's') + '</small></label>'; }).join('') +
      '<div class="pl-src-foot"><button type="button" class="btn pri" id="pl-ev-save">Save event types</button><span id="pl-ev-msg" class="ins-note" style="margin:0"></span></div></div>';
  }
  function bindSources() {
    if ($('pl-ev-save')) $('pl-ev-save').onclick = function () {
      var b = this; b.disabled = true; $('pl-ev-msg').textContent = 'Saving…';
      var skipped = [].filter.call(MAIN.querySelectorAll('[data-ev]'), function (c) { return !c.checked; }).map(function (c) { return c.getAttribute('data-ev'); });
      api('POST', { action: 'event-types', skipped: skipped }).then(function () { return load(false); }).then(function () { draw(); $('pl-ev-msg').textContent = 'Saved.'; }).catch(function (e) { $('pl-ev-msg').textContent = e.message; b.disabled = false; });
    };
    var root = MAIN.querySelector('.pl-src'); if (!root) return;
    [].forEach.call(root.querySelectorAll('[data-f]'), function (el) { el.oninput = el.onchange = function () { var i = +el.closest('.pl-src-row').getAttribute('data-i'); SRC_EDIT[i][el.getAttribute('data-f')] = el.value; }; });
    [].forEach.call(root.querySelectorAll('[data-del]'), function (b) { b.onclick = function () { SRC_EDIT.splice(+b.getAttribute('data-del'), 1); draw(); }; });
    $('pl-src-add').onclick = function () { SRC_EDIT.push({ name: '', url: '', tz: 'America/New_York' }); draw(); };
    $('pl-src-save').onclick = function () {
      var b = this; b.disabled = true; $('pl-src-msg').textContent = 'Saving…';
      api('POST', { action: 'sources', sources: SRC_EDIT }).then(function (r) { DATA.sources = r.sources; SRC_EDIT = null; draw(); $('pl-src-msg').textContent = 'Saved. The next sync will use these sheets.'; }).catch(function (e) { $('pl-src-msg').textContent = e.message; b.disabled = false; });
    };
  }

  /* ---------- Team access (admin) ---------- */
  var LAST_INVITE = null;
  function teamView() {
    var agents = uniq([].concat.apply([], DATA.leads.map(function (l) { return l.callers || []; })));
    var users = DATA.team || [];
    var st = { active: ['Active', 'st-showed'], invited: ['Invite sent', 'st-needs'], 'invite expired': ['Invite expired', 'st-noshow'] };
    return '<p class="sub" style="margin-top:-6px">Give a caller their own sign-in. They only see the Pipeline, and only their own leads and appointments (matched by the Agent Name in the Lead Entry sheets). They can\'t change anything or see the rest of the admin.</p>' +
      (LAST_INVITE ? '<div class="note pl-invite"><b>Invite link for ' + esc(LAST_INVITE.name) + '</b> (send it to them; it works once and expires in 7 days):<div class="pl-inv-row"><input type="text" readonly id="pl-inv-link" value="' + esc(LAST_INVITE.link) + '"><button type="button" class="btn" id="pl-inv-copy">Copy</button></div></div>' : '') +
      '<div class="card form" style="max-width:none;margin-bottom:14px"><h3 style="padding:0 0 12px">Add a person</h3><div class="pl-team-add"><label>Name<input type="text" id="pl-t-name" placeholder="Shayen"></label><label>Email<input type="text" id="pl-t-email" placeholder="name@example.com"></label><label>Agent Name in the sheets<input type="text" id="pl-t-agents" list="pl-agents" placeholder="Shayen"><datalist id="pl-agents">' + agents.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist></label><button type="button" class="btn pri" id="pl-t-add">Add and get invite link</button></div><small class="ins-note">Several names? Separate them with commas (for example: Joy, Joey).</small><p id="pl-t-msg" class="ins-note" style="margin:6px 0 0"></p></div>' +
      '<div class="card tablewrap pl-table">' + (users.length ? '<table><thead><tr><th>Person</th><th>Agent Name</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>' + users.map(function (u) {
        return '<tr data-u="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b><br><small>' + esc(u.email) + '</small></td><td><input type="text" class="pl-t-ag" value="' + esc((u.agents || []).join(', ')) + '"> <button type="button" class="mini" data-act="save">Save</button></td><td>' + tag(st, u.status) + '</td><td><small>' + (u.lastLogin ? ago(u.lastLogin) : '—') + '</small></td><td><div class="pl-outs" style="margin:0"><button type="button" class="mini" data-act="invite">' + (u.status === 'active' ? 'Reset password' : 'New invite link') + '</button><button type="button" class="mini pl-o-no_show" data-act="remove">Remove access</button></div></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">No team members yet.</div>') + '</div>';
  }
  function bindTeam() {
    var msg = $('pl-t-msg');
    if ($('pl-inv-copy')) $('pl-inv-copy').onclick = function () { var i = $('pl-inv-link'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } this.textContent = 'Copied'; };
    if ($('pl-t-add')) $('pl-t-add').onclick = function () {
      var b = this; b.disabled = true; msg.textContent = 'Adding…';
      api('POST', { action: 'team-add', name: $('pl-t-name').value, email: $('pl-t-email').value, agents: $('pl-t-agents').value }).then(function (r) { LAST_INVITE = { name: r.user.name, link: r.invite }; return load(false); }).then(draw).catch(function (e) { msg.textContent = e.message; b.disabled = false; });
    };
    [].forEach.call(MAIN.querySelectorAll('tr[data-u] button[data-act]'), function (b) {
      b.onclick = function () {
        var tr = b.closest('tr'), id = tr.getAttribute('data-u'), act = b.getAttribute('data-act'), u = (DATA.team || []).find(function (x) { return x.id === id; });
        if (act === 'remove' && !confirmInline(b)) return;
        b.disabled = true;
        var req = act === 'save' ? api('POST', { action: 'team-update', id: id, agents: tr.querySelector('.pl-t-ag').value }) : act === 'invite' ? api('POST', { action: 'team-invite', id: id }).then(function (r) { LAST_INVITE = { name: r.user.name, link: r.invite }; }) : api('POST', { action: 'team-remove', id: id });
        req.then(function () { return load(false); }).then(draw).catch(fail);
      };
    });
  }
  // Two-step button instead of a browser confirm() pop-up.
  function confirmInline(b) { if (b.getAttribute('data-sure')) return true; b.setAttribute('data-sure', '1'); b.textContent = 'Click again to remove'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-sure'); b.textContent = 'Remove access'; } }, 4000); return false; }

  function fail(e) { if (MAIN) { var n = document.createElement('div'); n.className = 'note'; n.textContent = e.message; MAIN.insertBefore(n, MAIN.firstChild); } }
  function draw() {
    if (!MAIN || !DATA) return;
    if (location.hash.indexOf('#pipeline') !== 0) return;
    if ((SUB === 'sources' || SUB === 'team') && !isAdmin()) SUB = '';
    var body = SUB === 'leads' ? leadsView() : SUB === 'meetings' ? meetingsView() : SUB === 'view' ? viewPage() : SUB === 'sources' ? sourcesView() : SUB === 'team' ? teamView() : dashboard();
    MAIN.innerHTML = head() + body;
    bindFilters();
    if (SUB === 'leads') drawLeadsTable();
    if (SUB === 'view' && $('pl-leads')) bindLeadRows($('pl-leads'));
    if (SUB === 'sources') bindSources();
    if (SUB === 'team') bindTeam(); else LAST_INVITE = null;
    bindMeetings(MAIN);
    var d = $('pl-dialog'); if (d && d.open) bindMeetings(d);
  }
  function route(parts, main) {
    MAIN = main; SUB = ['leads', 'meetings', 'view', 'sources', 'team'].indexOf(parts[0]) > -1 ? parts[0] : ''; VIEW = SUB === 'view' ? (parts[1] || '') : '';
    if (MAIN) MAIN.scrollTop = 0;
    if (DATA) { draw(); return; }
    main.innerHTML = '<h1>Pipeline</h1><div class="empty">Loading leads and meetings…</div>';
    (LOADING || load()).then(draw).catch(function (e) { main.innerHTML = '<h1>Pipeline</h1><div class="note">' + esc(e.message) + '</div>'; });
  }
  function nav() { return '<a href="#pipeline">Pipeline</a>'; }
  window.BH_PIPELINE = { route: route, nav: nav };
})();
