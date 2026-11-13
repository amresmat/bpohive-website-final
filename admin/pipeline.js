// Admin "Pipeline". The flow is simple:
//   a lead is booked (on a date, for a date) -> when the date comes it is a Show or a No-show ->
//   a show goes to "Shown" (the hot leads) and stays there while the team follows up through the trail ->
//   it goes to "Dead" when unqualified or not replying after many attempts (or "Won" when they sign).
// Every lead is Inbound (came through the website) or Outbound. Callers see only their own leads, read-only.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var DATA = null, MAIN = null, SUB = '', VIEW = '', LOADING = null;
  var F = { range: 30, from: '', to: '', preset: '30', open: '', type: '', campaign: '', caller: '', stage: '', q: '', mtab: '' };
  function iso10(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  // Date range presets, like the analytics portal: a preset fills the From and To dates, editing a date makes it custom.
  var PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['lastquarter', 'Last quarter'], ['all', 'All time']];
  var CUSTOM_OPEN = false;
  function applyPreset(p) {
    var now = new Date(), a = new Date(now), b = new Date(now);
    F.preset = p;
    if (p === 'all') { F.range = 0; F.from = ''; F.to = ''; return; }
    if (p === 'today') {}
    else if (p === 'yesterday') { a.setDate(a.getDate() - 1); b = new Date(a); }
    else if (p === 'lastquarter') { var q = Math.floor(now.getMonth() / 3) * 3; a = new Date(now.getFullYear(), q - 3, 1); b = new Date(now.getFullYear(), q, 0); }
    else if (p === 'month') a = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (p === 'lastmonth') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    else a.setDate(a.getDate() - (+p - 1));
    F.range = 'custom'; F.from = iso10(a); F.to = iso10(b);
  }
  applyPreset('30');
  var STATUS = { booked: ['Booked', 'st-booked'], to_mark: ['Date passed', 'st-needs'], shown: ['Showed', 'st-showed'], no_show: ['No-show', 'st-noshow'], dead: ['Not replying or unqualified', 'st-off'], won: ['Won', 'st-won'], cancelled: ['Cancelled', 'st-off'], new: ['No meeting yet', 'st-new'] };
  var OUT = { upcoming: ['Booked', 'st-booked'], needs: ['Date passed', 'st-needs'], showed: ['Show', 'st-showed'], no_show: ['No-show', 'st-noshow'], rescheduled: ['Rescheduled', 'st-off'], cancelled: ['Cancelled', 'st-off'] };
  var HOT = { contract: ['Waiting on contract', '#7a5af5'] };
  var OLD_HOT = { must_close: ['Must close', '#c0392b'], nurture: ['Nurture', '#1B7381'] }; // only for older trail entries
  var HOT_RANK = { contract: 0 };
  // Hot = actively engaging, warm = replying but not deciding now, cold = replying, longer timeframe.
  var TEMP = { hot: ['Hot', 'Actively engaging'], warm: ['Warm', 'Replying, not deciding now'], cold: ['Cold', 'Replying, longer timeframe'] };
  var TEMP_RANK = { hot: 0, warm: 1, cold: 2 };
  function tempTag(k) { return TEMP[k] ? '<span class="pl-temp pl-temp-' + k + '" title="' + esc(TEMP[k][1]) + '">' + TEMP[k][0] + '</span>' : ''; }
  function byTemp(a, b) { var ra = a.temp in TEMP_RANK ? TEMP_RANK[a.temp] : 3, rb = b.temp in TEMP_RANK ? TEMP_RANK[b.temp] : 3; var ha = a.hot in HOT_RANK ? HOT_RANK[a.hot] : 9, hb = b.hot in HOT_RANK ? HOT_RANK[b.hot] : 9; return ra - rb || ha - hb || (overdue(b.nextStep) ? 1 : 0) - (overdue(a.nextStep) ? 1 : 0) || (b.lastActivity || 0) - (a.lastActivity || 0); }
  var REASON = { unqualified: 'Unqualified', no_reply: 'Not replying', other: 'Other' };
  var BTNS = [['showed', 'Show'], ['no_show', 'No-show'], ['rescheduled', 'Rescheduled'], ['cancelled', 'Cancelled']];

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
  function statusTag(k) { return tag(STATUS, k); }
  // Dead leads are split in two: unqualified, and everyone else (not replying).
  function deadBucket(l) { return l.status !== 'dead' ? '' : l.deadReason === 'unqualified' ? 'unqualified' : 'no_reply'; }
  function leadTag(l) { return l.status === 'dead' ? '<span class="st st-off">' + (deadBucket(l) === 'unqualified' ? 'Unqualified' : 'Not replying') + '</span>' : statusTag(l.status); }
  function hotTag(k) { var h = HOT[k]; return h ? '<span class="pl-deal" style="--c:' + h[1] + '">' + esc(h[0]) + '</span>' : ''; }
  function seqTag(m) { var o = function (n) { return n + (n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }; return m.seq > 1 ? '<span class="pl-seq">' + o(m.seq) + ' meeting</span>' : m.seq === 1 ? '<span class="pl-seq pl-seq1">1st meeting</span>' : ''; }
  function money(v) { return v ? '$' + Number(v).toLocaleString() : ''; }
  function clock(ts) { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function dueTxt(n) { if (!n || !n.due) return ''; var d = new Date(n.due + 'T12:00:00'); var days = Math.round((new Date(n.due + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5); return days < 0 ? 'overdue ' + (-days) + 'd' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function overdue(n) { return n && n.due && new Date(n.due + 'T23:59:59') < new Date(); }
  function myName() { try { return localStorage.getItem('bh_pl_name') || ''; } catch (e) { return ''; } }
  function setMyName(v) { try { localStorage.setItem('bh_pl_name', v); } catch (e) {} }
  function isAdmin() { return DATA && DATA.role === 'admin'; }
  function campaignOf(l) { return (l.campaigns || [])[0] || ''; }
  function inRange(ts) {
    if (F.range === 'custom') {
      var a = F.from ? +new Date(F.from + 'T00:00:00') : -Infinity, b = F.to ? +new Date(F.to + 'T00:00:00') + 864e5 : Infinity;
      return t(ts) >= a && t(ts) < b;
    }
    return !F.range || t(ts) >= Date.now() - F.range * 864e5;
  }
  function leadByKey(k) { return DATA.leads.find(function (l) { return l.key === k; }) || DATA.leads.find(function (l) { return (l.aliases || []).indexOf(k) > -1; }); }
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
    var line = (c.connected ? 'Calendly synced ' + ago(c.lastSync) : 'Calendly not connected') + ', ' + (sh.files.length ? 'Sheets synced ' + ago(sh.lastSync) : 'Sheets not connected') + ', ' + (s.fathom && s.fathom.connected ? 'Fathom synced ' + ago(s.fathom.lastSync) : 'Fathom not connected');
    var needs = DATA.meetings.filter(function (m) { return m.outcome === 'needs'; }).length;
    // Stage pages (Showed, No-shows, Won...) open from the dashboard tiles, so they are not repeated as tabs.
    var tabs = [['', 'Dashboard', ''], ['booked', 'Meetings', needs ? needs + ' to mark' : ''], ['leads', 'All leads', '']];
    if (isAdmin()) tabs.push(['sources', 'Sources', ''], ['team', 'Team', '']);
    var onTab = function (k) { return SUB === k || (!k && ['', 'view', 'stages', 'shown', 'noshow', 'noreply', 'unqualified', 'won'].indexOf(SUB) > -1); };
    return '<div class="ins-head pl-head"><h1>Pipeline</h1><button class="btn" id="pl-refresh" type="button" title="' + esc(line) + '">Refresh</button></div>' +
      (isAdmin() ? setup() + intelNote() : '') +
      '<div class="tabs">' + tabs.map(function (x) { return '<a class="tab' + (onTab(x[0]) ? ' on' : '') + '" href="#pipeline' + (x[0] ? '/' + x[0] : '') + '">' + x[1] + (x[2] !== '' ? '<b>' + esc(x[2]) + '</b>' : '') + '</a>'; }).join('') + '</div>';
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
    return (withRange ? dateBar() : '') + '<div class="bar">' +
      (withRange ? '' : '<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">') +
      '<select id="pl-type"><option value="">Inbound + outbound</option><option value="inbound"' + (F.type === 'inbound' ? ' selected' : '') + '>Inbound only</option><option value="outbound"' + (F.type === 'outbound' ? ' selected' : '') + '>Outbound only</option></select>' +
      '<select id="pl-campaign">' + opts(camps, F.campaign, 'All campaigns') + '</select>' +
      (isAdmin() ? '<select id="pl-caller">' + opts(callers, F.caller, 'All callers') + '</select>' : '') +
      (withStage ? '<select id="pl-stage">' + '<option value="">Every status</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (F.stage === k ? ' selected' : '') + '>' + STATUS[k][0] + '</option>'; }).join('') + '</select>' : '') +
      '</div>';
  }
  function shortDay(v) { var p = String(v).split('-').map(Number); return p[0] ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : v; }
  function dateBar() {
    var showInputs = CUSTOM_OPEN || !F.preset;
    var summary = F.preset === 'all' || !F.range ? 'All time' : F.from === F.to ? shortDay(F.from) : shortDay(F.from) + ' to ' + shortDay(F.to);
    return '<div class="pl-datebar" role="group" aria-label="Date range"><div class="pl-presets">' + PRESETS.map(function (p) { var on = !CUSTOM_OPEN && F.preset === p[0]; return '<button type="button" class="pl-pill' + (on ? ' on' : '') + '" data-p="' + p[0] + '" aria-pressed="' + on + '">' + p[1] + '</button>'; }).join('') +
      '<button type="button" class="pl-pill' + (showInputs ? ' on' : '') + '" id="pl-custom" aria-pressed="' + showInputs + '" aria-expanded="' + showInputs + '">Custom dates</button></div>' +
      '<p class="pl-showing">Showing ' + esc(summary) + '</p>' +
      (showInputs ? '<form class="pl-custom" id="pl-custom-form" novalidate><label for="pl-from">From<input id="pl-from" type="date" value="' + esc(F.from) + '"' + (F.to ? ' max="' + esc(F.to) + '"' : '') + '></label><label for="pl-to">To<input id="pl-to" type="date" value="' + esc(F.to) + '"' + (F.from ? ' min="' + esc(F.from) + '"' : '') + '></label><button type="submit" class="btn pri">Apply</button></form>' : '') +
      '</div>';
  }
  function bindFilters() {
    [].forEach.call(document.querySelectorAll('.pl-presets button[data-p]'), function (b) { b.onclick = function () { CUSTOM_OPEN = false; applyPreset(b.getAttribute('data-p')); draw(); }; });
    var cb = $('pl-custom'); if (cb) cb.onclick = function () { CUSTOM_OPEN = !CUSTOM_OPEN; draw(); };
    var cf = $('pl-custom-form'); if (cf) cf.onsubmit = function (e) { e.preventDefault(); var a = $('pl-from').value, b = $('pl-to').value; if (!a || !b) return; if (a > b) { var t0 = a; a = b; b = t0; } F.from = a; F.to = b; F.range = 'custom'; F.preset = ''; CUSTOM_OPEN = false; draw(); };
    [['pl-type', 'type'], ['pl-campaign', 'campaign'], ['pl-caller', 'caller'], ['pl-stage', 'stage']].forEach(function (x) { var el = $(x[0]); if (el) el.onchange = function () { F[x[1]] = el.value; draw(); }; });
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
    return '<div class="card ins-table tablewrap"><h3>' + esc(title) + '</h3>' + (rows.length ? '<table><thead><tr><th>' + esc(keyName) + '</th><th class="num">New leads</th><th class="num">Booked</th><th class="num">Shows</th><th class="num">No-show</th><th class="num">Show rate</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.k) + '</td><td class="num">' + r.leads + '</td><td class="num">' + r.booked + '</td><td class="num">' + r.showed + '</td><td class="num">' + r.noshow + '</td><td class="num">' + (r.showed + r.noshow ? pct(r.showed, r.showed + r.noshow) + '%' : '—') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Nothing in this period yet.</div>') + '</div>';
  }
  // What each dashboard box counts. The "View" pages list exactly these, with the same filters.
  function sets() {
    var ms = DATA.meetings.filter(matchesMeeting);
    var booked = ms.filter(function (m) { return inRange(m.created); }).sort(function (a, b) { return t(b.created) - t(a.created); });
    var held = ms.filter(function (m) { return inRange(m.start) && t(m.start) < Date.now() && ['showed', 'no_show', 'needs'].indexOf(m.outcome) > -1; });
    var is = function (o) { return function (m) { return m.outcome === o; }; };
    var leads = DATA.leads.filter(matchesLead);
    return {
      ms: ms, booked: booked, held: held,
      bookedIn: booked.filter(function (m) { return m.type === 'inbound'; }), bookedOut: booked.filter(function (m) { return m.type !== 'inbound'; }),
      showed: held.filter(is('showed')), noshow: held.filter(is('no_show')), marked: held.filter(function (m) { return m.outcome !== 'needs'; }),
      needs: ms.filter(is('needs')),
      hot: leads.filter(function (l) { return l.status === 'shown'; }), dead: leads.filter(function (l) { return l.status === 'dead'; }), noreply: leads.filter(function (l) { return deadBucket(l) === 'no_reply'; }), unq: leads.filter(function (l) { return deadBucket(l) === 'unqualified'; }), won: leads.filter(function (l) { return l.status === 'won'; }),
      cohort: leads.filter(function (l) { return inRange(l.firstAt); })
    };
  }
  var VIEWS = {
    booked: ['Booked in this period', 'booked', 'Every meeting booked during this period, newest booking first.'],
    bookedIn: ['Inbound bookings', 'bookedIn', 'Booked through the website during this period.'],
    bookedOut: ['Outbound bookings', 'bookedOut', 'Booked by the callers or through a Calendly link the team sent.'],
    showed: ['Shows', 'showed', 'Meetings in this period the prospect showed up to.'],
    noshow: ['No-shows', 'noshow', 'Meetings in this period the prospect missed.'],
    rate: ['Marked meetings', 'marked', 'The meetings the show rate is worked out from (shows + no-shows).']
  };
  function viewLink(href, label) { return '<a class="pl-view" href="' + href + '">' + (label || 'View') + '</a>'; }
  // Booked -> Show -> Closed, counted per lead, for everyone booked in the period (the source filter
  // is ignored here so the three funnels always sit side by side).
  function funnel() {
    var ms = DATA.meetings.filter(function (m) { return (!F.campaign || (m.campaigns || []).indexOf(F.campaign) > -1) && (!F.caller || (m.callers || []).indexOf(F.caller) > -1) && inRange(m.created); });
    var keys = {}; ms.forEach(function (m) { if (m.leadKey) keys[m.leadKey] = 1; });
    var cohort = DATA.leads.filter(function (l) { return keys[l.key]; });
    var col = function (title, list, tone) {
      var b = list.length, sh = list.filter(function (l) { return l.shownAt || l.status === 'won'; }).length, cl = list.filter(function (l) { return l.status === 'won'; }).length;
      var steps = [['Booked', b, ''], ['Show', sh, b ? pct(sh, b) + '% of booked' : ''], ['Closed', cl, sh ? pct(cl, sh) + '% of shows' : '']];
      return '<div class="pl-fun pl-fun-' + tone + '"><h4>' + esc(title) + '</h4>' + steps.map(function (x, i) {
        return '<div class="pl-fun-step"><div class="pl-fun-top"><span>' + x[0] + '</span><b>' + x[1] + '</b></div><div class="pl-fun-bar"><i style="width:' + (b ? Math.max(x[1] / b * 100, x[1] ? 3 : 0) : 0).toFixed(1) + '%"></i></div><small>' + (x[2] || '&nbsp;') + '</small></div>';
      }).join('') + '<p class="pl-fun-end">' + (b ? pct(cl, b) + '% of bookings closed' : 'Nothing booked yet') + '</p></div>';
    };
    return '<div class="card pl-funnel"><h3>Booked, show, closed</h3><div class="pl-funs">' +
      col('All', cohort, 'all') + col('Inbound', cohort.filter(function (l) { return l.type === 'inbound'; }), 'in') + col('Outbound', cohort.filter(function (l) { return l.type !== 'inbound'; }), 'out') + '</div></div>';
  }
  // A lead belongs to the chosen dates when it came in, or had a meeting booked or held, inside them.
  function leadInRange(l) {
    if (!F.range) return true;
    if (inRange(l.firstAt)) return true;
    return (l.meetings || []).some(function (id) { var m = DATA.meetings.find(function (x) { return x.id === id; }); return m && (inRange(m.created) || inRange(m.start)); });
  }
  var STAGE_ROUTE = { booked: 'booked', shown: 'shown', no_show: 'noshow', no_reply: 'noreply', unqualified: 'unqualified', won: 'won' };
  function stagePanel(k, leads) {
    var st = STAGES.filter(function (s) { return s[0] === k; })[0], rows = leads.filter(st[3]).sort(function (a, b) { return (b.lastActivity || 0) - (a.lastActivity || 0); });
    return '<div class="card pl-sopen" id="pl-sopen" style="--c:' + st[2] + '"><div class="pl-sopen-h"><h3>' + esc(st[1]) + ' <span>' + rows.length + '</span></h3><a href="#pipeline/' + STAGE_ROUTE[k] + '">Open full view</a><button type="button" class="pl-sclose" aria-label="Close">Close</button></div>' +
      (rows.length ? '<div class="tablewrap pl-table">' + leadTable(rows.slice(0, 200)) + '</div>' : '<div class="empty">No leads in this stage for these dates.</div>') + '</div>';
  }
  function bindStageTiles() {
    // Same tile motion as the analytics portal: a spotlight and edge light follow the pointer, and the tile tilts toward it.
    [].forEach.call(MAIN.querySelectorAll('.kpi-tile'), function (el) {
      el.onpointermove = function (e) { if (e.pointerType === 'touch') return; var r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; el.style.setProperty('--spot-x', x + 'px'); el.style.setProperty('--spot-y', y + 'px'); el.style.setProperty('--tilt-x', ((0.5 - y / r.height) * 5).toFixed(2) + 'deg'); el.style.setProperty('--tilt-y', ((x / r.width - 0.5) * 5).toFixed(2) + 'deg'); };
      el.onpointerleave = function () { el.style.setProperty('--tilt-x', '0deg'); el.style.setProperty('--tilt-y', '0deg'); };
    });
    [].forEach.call(MAIN.querySelectorAll('.kpi-value[data-st]'), function (b) { b.onclick = function () { var k = b.getAttribute('data-st'); F.open = F.open === k ? '' : k; draw(); var p = $('pl-sopen'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }; });
    var c = MAIN.querySelector('.pl-sclose'); if (c) c.onclick = function () { F.open = ''; draw(); };
    var p = $('pl-sopen'); if (p) bindLeadRows(p);
  }
  function rangeLabel() {
    if (F.range === 'custom') return (F.from ? day(F.from + 'T12:00:00') : 'Start') + ' to ' + (F.to ? day(F.to + 'T12:00:00') : 'today');
    return F.range ? 'Last ' + F.range + ' days' : 'All time';
  }
  function dashboard() {
    var S = sets(), showed = S.showed.length, noshow = S.noshow.length, needs = S.needs.length;
    var sub = function (k, n, label) { return n ? '<a href="#pipeline/view/' + k + '">' + n + ' ' + label + '</a>' : '0 ' + label; };
    var now = DATA.leads.filter(matchesLead).filter(leadInRange), sc = stageCounts(now);
    if (F.open && !STAGES.some(function (s) { return s[0] === F.open; })) F.open = '';
    var upcoming = S.ms.filter(function (m) { return m.outcome === 'upcoming' && t(m.start) < Date.now() + 7 * 864e5; }).sort(function (a, b) { return t(a.start) - t(b.start); });
    var weeks = 12;
    var lc = weekly(S.ms, function (m) { return t(m.created); }, function (m) { return m.type; }, weeks);
    var mc = weekly(S.ms.filter(function (m) { return t(m.start) < Date.now(); }), function (m) { return t(m.start); }, function (m) { return m.outcome; }, weeks);
    return filters(true, false) +
      '<div class="pl-stiles">' + STAGES.map(function (s) { var on = F.open === s[0]; return '<div class="kpi-tile' + (on ? ' on' : '') + '" style="--c:' + s[2] + '"><div class="kpi-label"><i></i>' + esc(s[1]) + '</div><button type="button" class="kpi-value" data-st="' + s[0] + '" aria-expanded="' + on + '" aria-controls="pl-sopen">' + sc[s[0]] + '</button><p class="kpi-action">' + (on ? 'Hide leads' : 'View leads') + ' <span class="kpi-arrow">&rarr;</span></p></div>'; }).join('') + '</div>' +
      (F.open ? stagePanel(F.open, now) : '') +
      funnel() +
      '<div class="ins-grid">' + bars(lc, [['inbound', 'Inbound', '#6F9FC4'], ['outbound', 'Outbound', '#1B7381']], 'Meetings booked per week') +
      bars(mc, [['showed', 'Show', '#2B6E4C'], ['no_show', 'No-show', '#B5523F'], ['needs', 'Not marked yet', '#D6A34A'], ['rescheduled', 'Rescheduled', '#A9B4BA'], ['cancelled', 'Cancelled', '#D5DBDE']], 'Meetings per week') + '</div>' +
      '<div class="card ins-table" style="margin-bottom:14px"><h3>Next 7 days</h3>' + (upcoming.length ? meetingTable(upcoming, true) : '<div class="empty">No meetings booked for the next 7 days.</div>') + '</div>' +
      breakdown('By campaign', 'Campaign', function (l) { return (l.campaigns || []).length ? l.campaigns : [l.type === 'inbound' ? 'Booked on the website' : 'Calendly link from the team']; }) +
      '<div style="height:14px"></div>' + breakdown('By caller', 'Caller', function (l) { return (l.callers || []).length ? l.callers : [l.type === 'inbound' ? 'Inbound (no caller)' : 'Unassigned']; });
  }
  function viewPage() {
    var v = VIEWS[VIEW] || VIEWS.booked, rows = sets()[v[1]] || [];
    var more = { booked: [['bookedIn', 'Inbound'], ['bookedOut', 'Outbound']], bookedIn: [['booked', 'All'], ['bookedOut', 'Outbound']], bookedOut: [['booked', 'All'], ['bookedIn', 'Inbound']] }[VIEW] || [];
    return '<p class="pl-back"><a href="#pipeline">Back to dashboard</a></p><div class="pl-vhead"><h2>' + esc(v[0]) + ' <span>' + rows.length + '</span></h2>' + (more.length ? '<div class="pl-vlinks">' + more.map(function (x) { return '<a href="#pipeline/view/' + x[0] + '">' + esc(x[1]) + '</a>'; }).join('') + '</div>' : '') + '</div>' +
      '<p class="ins-note" style="margin:-2px 0 10px">' + esc(v[2]) + '</p>' + filters(true, false) +
      '<div class="card tablewrap pl-table" id="pl-meetings">' + (rows.length ? meetingTable(rows.slice(0, 500), false) : '<div class="empty">Nothing here for this period.</div>') + '</div>';
  }

  /* ---------- Booked: every meeting; when the date passes, mark Show or No-show ---------- */
  function outcomeButtons(m) {
    if (!isAdmin()) return '';
    if (m.outcome === 'upcoming') return '<div class="pl-outs">' + BTNS.slice(2).map(function (b) { return '<button type="button" class="mini" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>';
    return '<div class="pl-outs">' + BTNS.map(function (b) { return '<button type="button" class="mini pl-o-' + b[0] + (m.outcome === b[0] ? ' on' : '') + (b[0] === 'showed' || b[0] === 'no_show' ? ' big' : '') + '" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + (!m.auto ? '<button type="button" class="mini pl-undo" data-m="' + esc(m.id) + '" data-o="clear" title="Go back to what Calendly or the sheet says">Undo</button>' : '') + '</div>';
  }
  function meetingTable(rows, compact) {
    return '<table><thead><tr><th>For</th><th>Booked on</th><th>Who</th><th>Source</th><th>Meeting</th><th>' + (compact ? 'Status' : 'Show or no-show') + '</th></tr></thead><tbody>' + rows.map(function (m) {
      var who = m.invitee.name || m.invitee.email || '(unknown)';
      return '<tr class="pl-m-' + m.outcome + '" data-k="' + esc(m.leadKey || '') + '"><td class="pl-when">' + when(m.start) + '</td><td><small><span class="pl-mlabel">Booked on </span>' + (m.created ? esc(day(m.created)) : '—') + '</small></td><td><b>' + esc(who) + '</b><br><small>' + esc([m.company, m.invitee.email].filter(Boolean).join(', ')) + '</small></td><td>' + typeTag(m.type) + (m.callers.length ? '<br><small>' + esc(m.callers.join(', ')) + '</small>' : '') + '</td><td>' + esc(m.name) + (seqTag(m) ? ' ' + seqTag(m) : '') + (m.host ? '<br><small>with ' + esc(m.host) + '</small>' : '') + (m.sheet ? '<br><small>' + esc(m.sheet.source) + (m.sheet.confirm ? ', ' + esc(m.sheet.confirm) : '') + '</small>' : '') + (m.sheet && m.sheet.recording ? '<br>' + playBtn(m.sheet.recording, 'Play booking call') : '') + (m.fathom && m.fathom.url ? '<br><a class="pl-rec" href="' + esc(m.fathom.url) + '" target="_blank" rel="noopener">Fathom recording</a>' : '') + '</td><td>' + tag(OUT, m.outcome) + (m.viaFathom ? ' <small class="pl-via">from Fathom</small>' : '') + (m.viaSheet ? ' <small class="pl-via">from sheet</small>' : '') + (compact ? '' : outcomeButtons(m)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function bookedView() {
    var ms = DATA.meetings.filter(matchesMeeting), now = Date.now();
    var groups = { needs: ms.filter(function (m) { return m.outcome === 'needs'; }), upcoming: ms.filter(function (m) { return m.outcome === 'upcoming'; }).sort(function (a, b) { return t(a.start) - t(b.start); }), past: ms.filter(function (m) { return t(m.start) < now && m.outcome !== 'needs'; }) };
    if (!groups[F.mtab]) F.mtab = groups.needs.length ? 'needs' : 'upcoming';
    var rows = groups[F.mtab] || [];
    return filters(false, false).replace('<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">', '') +
      '<div class="tabs pl-mtabs">' + [['needs', 'Date passed'], ['upcoming', 'Upcoming'], ['past', 'Already marked']].map(function (x) { return '<button type="button" class="tab' + (F.mtab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '">' + x[1] + '<b>' + groups[x[0]].length + '</b></button>'; }).join('') + '</div>' +
      (F.mtab === 'needs' && rows.length && isAdmin() ? '<p class="ins-note" style="margin:-4px 0 10px">The date came. Click <b>Show</b> or <b>No-show</b>. A show goes straight to the <a href="#pipeline/shown">Showed</a> tab.</p>' : '') +
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
    [].forEach.call(root.querySelectorAll('tr[data-k]'), function (tr) { if (tr.closest('.pl-pane, .pl-dialog')) { tr.onclick = null; return; } tr.onclick = function () { var k = tr.getAttribute('data-k'); if (k) openLead(k); }; });
  }

  /* ---------- Shown: the hot leads, in one place, updated through the trail ---------- */
  var SEL = '', HOTF = '';
  var TEAM_MAILS = ['amr@bpohive.com', 'abdullah@bpohive.com', 'info@bpohive.com', 'success@bpohive.com'];
  function mailBox(l) {
    var me = myName(), first = String(l.name || '').trim().split(/\s+/)[0] || 'there';
    first = first.charAt(0).toUpperCase() + first.slice(1);
    var mine = TEAM_MAILS.filter(function (e) { return me && e.indexOf(me.toLowerCase().split(/\s+/)[0] + '@') === 0; })[0] || TEAM_MAILS[0];
    var body = 'Hi ' + first + ',\n\nThanks again for your time. Following up on our conversation.\n\nWould you have 15 minutes this week to go over next steps?\n\nBest,\n' + (me || 'Amr') + '\nBPO Hive';
    return '<div class="pl-mailbox" id="pl-m-box" hidden><div class="pl-mail-row"><label>To<input type="email" id="pl-m-to" value="' + esc(l.email || '') + '" placeholder="name@company.com"></label><label>Cc <small>(optional)</small><input type="text" id="pl-m-cc" placeholder="abdullah@bpohive.com"></label></div>' +
      '<div class="pl-mail-row"><label>Your name<input type="text" id="pl-m-from" value="' + esc(me) + '" placeholder="Amr"></label><label>Replies go to<select id="pl-m-reply">' + TEAM_MAILS.map(function (e) { return '<option' + (e === mine ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Subject<input type="text" id="pl-m-subj" value="' + esc('Following up' + (l.company ? ', ' + l.company : '')) + '"></label>' +
      '<label>Message<textarea id="pl-m-body" rows="8">' + esc(body) + '</textarea></label>' +
      '<div class="pl-m-files"><label class="pl-m-attach"><input type="file" id="pl-m-file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.gif,.zip,.rtf,.odt,.ods,.odp"><span>Attach files</span></label><ul id="pl-m-list"></ul><small>PDF, Word, Excel, PowerPoint, images or ZIP, up to 3 MB in total</small></div>' +
      '<label class="pl-m-copy"><input type="checkbox" id="pl-m-copy" checked> Send a copy to my inbox (the address replies go to)</label>' +
      '<div class="pl-editbox-act"><button type="button" class="btn pri" id="pl-m-send">Send email</button><button type="button" class="btn" id="pl-m-cancel">Cancel</button><a id="pl-m-app" class="pl-m-app" href="#">Open in my email app instead</a><span class="ins-note" id="pl-m-msg" style="margin:0"></span></div>' +
      '<p class="ins-note" style="margin:8px 0 0">Sent from success@bpohive.com with your name. Their reply and your copy go to the address you pick, and it is saved on the trail.</p></div>';
  }
  function addLeadDialog(stage) {
    var d = dlg(), st = STAGES.some(function (s) { return s[0] === stage; }) ? stage : 'shown';
    d.innerHTML = '<div class="dl"><button class="x" type="button" aria-label="Close">×</button><h2>Add a lead</h2><p class="ins-note" style="margin:4px 0 14px">For someone who is not in Calendly or the Lead Entry sheets yet. Pick the stage they are at.</p>' +
      '<div class="pl-a-stages" role="radiogroup" aria-label="Stage">' + STAGES.map(function (s) { return '<label style="--c:' + s[2] + '"><input type="radio" name="pl-a-stage" value="' + s[0] + '"' + (s[0] === st ? ' checked' : '') + '><span>' + s[1] + '</span></label>'; }).join('') + '</div>' +
      '<div class="pl-a-when" id="pl-a-when"><label>Meeting date<input type="date" id="pl-a-date"></label><label>Time<input type="time" id="pl-a-time" value="10:00"></label></div>' +
      '<div class="pl-upd-row pl-add-f"><label>Name<input type="text" id="pl-a-name"></label><label>Company<input type="text" id="pl-a-co"></label><label>Country<input type="text" id="pl-a-country"></label><label>Phone<input type="text" id="pl-a-phone"></label><label>Email<input type="text" id="pl-a-email"></label><label>Source<select id="pl-a-type"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label></div>' +
      '<label class="pl-a-note">What they need / first update<textarea id="pl-a-note" rows="3"></textarea></label>' +
      '<div class="pl-upd-act"><button class="btn pri" id="pl-a-save" type="button"></button><span id="pl-a-msg" class="ins-note" style="margin:0"></span></div></div>';
    d.querySelector('.x').onclick = function () { d.close(); };
    var q = function (id) { return d.querySelector('#' + id); };
    var cur = function () { var r = d.querySelector('input[name=pl-a-stage]:checked'); return r ? r.value : 'shown'; };
    var sync = function () { var s = cur(), lab = STAGES.filter(function (x) { return x[0] === s; })[0]; q('pl-a-when').style.display = s === 'booked' || s === 'no_show' ? '' : 'none'; q('pl-a-save').textContent = 'Add to ' + (lab ? lab[1] : 'Showed'); };
    [].forEach.call(d.querySelectorAll('input[name=pl-a-stage]'), function (r) { r.onchange = sync; });
    sync();
    q('pl-a-save').onclick = function () {
      var b = this, s = cur(), dt = q('pl-a-date').value, tm = q('pl-a-time').value || '10:00';
      if (s === 'booked' && !dt) { q('pl-a-msg').textContent = 'Pick the meeting date.'; q('pl-a-date').focus(); return; }
      b.disabled = true; q('pl-a-msg').textContent = 'Adding…';
      api('POST', { action: 'lead-add', stage: s, meetingAt: dt ? new Date(dt + 'T' + tm).toISOString() : '', name: q('pl-a-name').value, company: q('pl-a-co').value, country: q('pl-a-country').value, phone: q('pl-a-phone').value, email: q('pl-a-email').value, type: q('pl-a-type').value, note: q('pl-a-note').value, by: myName() })
        .then(function (r) { SEL = r.key; d.close(); return load(false); }).then(draw).catch(function (e) { q('pl-a-msg').textContent = e.message; b.disabled = false; });
    };
    if (!d.open) d.showModal();
  }
  function lastNote(l) { return (l.trail || []).filter(function (x) { return x.kind === 'note'; }).slice(-1)[0]; }
  function shownView() {
    var q = F.q.trim().toLowerCase();
    var all = DATA.leads.filter(matchesLead).filter(function (l) { return l.status === 'shown' && (!q || [l.name, l.company, l.email].join(' ').toLowerCase().indexOf(q) > -1); })
      .sort(byTemp);
    var idle = function (l) { return l.lastActivity && Date.now() - l.lastActivity > 14 * 864e5; };
    var due = function (l) { return l.nextStep && l.nextStep.due && new Date(l.nextStep.due + 'T00:00:00') <= new Date(); };
    var rows = HOTF.indexOf('t:') === 0 ? all.filter(function (l) { return (l.temp || 'none') === HOTF.slice(2); }) : HOTF === 'due' ? all.filter(due) : HOTF === 'idle' ? all.filter(idle) : HOT[HOTF] ? all.filter(function (l) { return l.hot === HOTF; }) : HOTF === 'inbound' || HOTF === 'outbound' ? all.filter(function (l) { return l.type === HOTF; }) : all;
    if (!rows.some(function (l) { return l.key === SEL; })) SEL = rows[0] ? rows[0].key : '';
    var chips = [['', 'All', all.length]].concat(Object.keys(TEMP).map(function (k) { return ['t:' + k, TEMP[k][0], all.filter(function (l) { return l.temp === k; }).length, k]; })).concat(all.some(function (l) { return !l.temp; }) ? [['t:none', 'Not set', all.filter(function (l) { return !l.temp; }).length]] : []).concat(Object.keys(HOT).map(function (k) { return [k, HOT[k][0], all.filter(function (l) { return l.hot === k; }).length]; })).concat([['due', 'Follow-up due', all.filter(due).length], ['idle', 'No update in 14+ days', all.filter(idle).length], ['inbound', 'Inbound', all.filter(function (l) { return l.type === 'inbound'; }).length], ['outbound', 'Outbound', all.filter(function (l) { return l.type !== 'inbound'; }).length]]).filter(function (c) { return c[0] === '' || !HOT[c[0]] || c[2]; });
    return '<div class="bar"><input id="pl-q" type="search" placeholder="Search name or company" value="' + esc(F.q) + '">' + filters(false, false).replace(/^<div class="bar">|<\/div>$/g, '').replace(/<input id="pl-q"[^>]*>/, '').replace(/<select id="pl-type">[\s\S]*?<\/select>/, '') + '</div>' +
      '<div class="pl-chips">' + chips.map(function (c) { return '<button type="button" data-hf="' + c[0] + '" class="' + (HOTF === c[0] ? 'on' : '') + (c[3] ? ' pl-chip-' + c[3] : '') + '">' + esc(c[1]) + ' <b>' + c[2] + '</b></button>'; }).join('') + (isAdmin() ? '<button type="button" id="pl-add" class="pl-add">+ Add a lead</button>' : '') + '</div>' +
      '<div class="pl-hcards">' + (rows.length ? rows.map(function (l) { return hcard(l, 'shown'); }).join('') : '<div class="card empty">' + (all.length ? 'Nobody matches.' : 'No hot leads yet. When a meeting happens, mark it Show under Booked and the lead lands here.') + '</div>') + '</div>';
  }
  function bindShown() {
    var add = $('pl-add'); if (add) add.onclick = function () { addLeadDialog('shown'); };
    [].forEach.call(MAIN.querySelectorAll('[data-hf]'), function (b) { b.onclick = function () { HOTF = b.getAttribute('data-hf'); draw(); }; });
    var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; var pos = q.selectionStart; draw(); var n = $('pl-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    bindHcards(MAIN);
  }

  /* ---------- Call summaries (from Fathom) ---------- */
  function mdPlain(t) { return String(t || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/\n{2,}/g, '\n').trim(); }
  function mdLite(t) {
    var out = [], list = false;
    String(t || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var x = esc(line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      var li = /^\s*[-*]\s+(.*)$/.exec(x), h = /^\s*#+\s*(.*)$/.exec(x);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + li[1] + '</li>'); return; }
      if (list) { out.push('</ul>'); list = false; }
      if (h) out.push('<h4>' + h[1] + '</h4>'); else if (x.trim()) out.push('<p>' + x + '</p>');
    });
    if (list) out.push('</ul>');
    return out.join('');
  }
  function summaryOf(l) { return (l.recordings || []).filter(function (r) { return r.summary; }).sort(function (a, b) { return t(b.start) - t(a.start); }); }
  function summaryGist(r) {
    var txt = String(r.summary || ''), m = null;
    ['key takeaways', 'takeaways', 'summary', 'meeting purpose'].some(function (h) { m = new RegExp('#+\\s*' + h + '[^\\n]*\\n([\\s\\S]*?)(\\n#+\\s|$)', 'i').exec(txt); return m; });
    var g = mdPlain(m ? m[1] : txt).split('\n').filter(Boolean).slice(0, 3).join('; ');
    return g.length > 240 ? g.slice(0, 237).replace(/\s+\S*$/, '') + '…' : g;
  }
  function summarySection(l) {
    var rs = summaryOf(l); if (!rs.length) return '';
    var one = function (r, open) {
      return '<details class="pl-sum"' + (open ? ' open' : '') + '><summary><b>' + esc(r.title || 'Call') + '</b> <small>' + esc(when(r.start)) + (r.recordedBy ? ', recorded by ' + esc(r.recordedBy) : '') + '</small></summary>' +
        '<div class="pl-sum-b">' + mdLite(r.summary) + ((r.actions || []).length ? '<h4>Action items</h4><ul>' + r.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
        (r.url ? '<p><a href="' + esc(r.url) + '" target="_blank" rel="noopener">Watch in Fathom</a></p>' : '') + '</div></details>';
    };
    return '<div class="pl-sums"><h3 class="pl-h" style="margin-top:0">Call summary' + (rs.length > 1 ? 's' : '') + '</h3>' + rs.map(function (r, i) { return one(r, i === 0); }).join('') + '</div>';
  }

  /* ---------- Call recordings (the link from the Lead Entry sheet) ---------- */

  function audioUrl(u) {
    var m = /^https?:\/\/(?:www\.)?(?:voca\.ro|vocaroo\.com)\/(?:embed\/)?([A-Za-z0-9]+)/i.exec(u || ''); if (m) return 'https://media.vocaroo.com/mp3/' + m[1];
    if (/^https:\/\/[^\/]*twil+io[^\/]*\//i.test(u || '') || /^https:\/\/[^?#]+\.(mp3|wav|m4a|ogg|oga|webm|aac)([?#]|$)/i.test(u || '')) return u;
    return '';
  }
  function driveId(u) { var m = /drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(u || ''); return m ? m[1] : ''; }
  function canPlay(u) { return Boolean(audioUrl(u) || driveId(u)); }
  function recPlayer(u, autoplay, compact) {
    var a = audioUrl(u), d = driveId(u);
    if (a) return '<span class="pl-player"><audio controls preload="' + (autoplay ? 'auto' : 'none') + '"' + (autoplay ? ' autoplay' : '') + ' src="' + esc(a) + '"></audio><a href="' + esc(u) + '" target="_blank" rel="noopener">Open link</a></span>';
    if (d) return '<span class="pl-player pl-player-f"><iframe src="https://drive.google.com/file/d/' + esc(d) + '/preview" allow="autoplay" loading="lazy" title="Call recording"></iframe></span>';
    return '<a class="pl-rec" href="' + esc(u) + '" target="_blank" rel="noopener">' + (/salesfinity/i.test(u) ? 'Open in Salesfinity' : 'Open recording') + '</a>' + (/salesfinity/i.test(u) && !compact ? ' <small class="pl-via">plays there, with your Salesfinity login. No AI summary for Salesfinity calls.</small>' : '');
  }
  function playBtn(u, label, compact) { return canPlay(u) ? '<button type="button" class="pl-play" data-rec="' + esc(u) + '"><i aria-hidden="true"></i>' + esc(label || 'Play call') + '</button>' : recPlayer(u, false, compact); }
  function recsOf(l) {
    var seen = {};
    return (l.meetings || []).map(function (id) { return DATA.meetings.find(function (m) { return m.id === id; }); })
      .filter(function (m) { return m && m.sheet && m.sheet.recording && !seen[m.sheet.recording] && (seen[m.sheet.recording] = 1); })
      .sort(function (a, b) { return t(a.created || a.start) - t(b.created || b.start); });
  }
  /* ---------- Company profile and booking-call summaries (made by the server, lib/intel.cjs) ---------- */
  function coOf(l) { var c = l.intel && l.intel.company; return c && c.found && !c.error ? c : null; }
  function callSumOf(l, u) { var c = l.intel && l.intel.calls && l.intel.calls[u]; return c && c.summary ? c : null; }
  function latestCallSum(l) { var rs = recsOf(l); for (var i = rs.length - 1; i >= 0; i--) { var c = callSumOf(l, rs[i].sheet.recording); if (c) return c; } var sf = (l.sfCalls || []).map(function (x) { return callSumOf(l, 'sf:' + x.id); }).filter(Boolean)[0]; return sf || null; }
  function sfPlayer(c, compact) {
    if (compact) return (c.recording ? '<button type="button" class="pl-play pl-play-sf" data-sfrec="' + esc(c.recording) + '" data-sflink="' + esc(c.link || '') + '"><i aria-hidden="true"></i>Play call</button>' : '') + (c.link && !c.recording ? '<a class="pl-rec" href="' + esc(c.link) + '" target="_blank" rel="noopener">Open in Salesfinity</a>' : '');
    return (c.recording ? '<span class="pl-player"><audio controls preload="none" src="' + esc(c.recording) + '"></audio></span>' : '') + (c.link ? ' <a class="pl-rec" href="' + esc(c.link) + '" target="_blank" rel="noopener">Open in Salesfinity</a>' : ''); }
  function facts(c) { return [c.revenue ? 'Revenue ' + c.revenue : '', c.employees ? String(c.employees).replace(/\s*\(.*\)$/, '') + ' employees' : '', c.industry, c.hq].filter(Boolean); }
  function bulletGist(t) { var g = String(t || '').split('\n').map(function (x) { return x.replace(/^\s*[-*•]\s*/, '').trim(); }).filter(Boolean).slice(0, 2).join('; '); return g.length > 230 ? g.slice(0, 227).replace(/\s+\S*$/, '') + '…' : g; }
  function coSection(l) {
    var c = coOf(l), it = l.intel && l.intel.company;
    if (!c) return it && !it.error && !it.found ? '<div class="pl-co"><h3 class="pl-h" style="margin-top:0">Company</h3><p class="ins-note" style="margin:0">Couldn\'t identify this company on the web. Add the company name or website with Edit contact.</p></div>' : '';
    var row = function (k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>' : ''; };
    var host = function (u) { return String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); };
    return '<div class="pl-co"><h3 class="pl-h" style="margin-top:0">' + esc(c.name || l.company || 'Company') + '</h3>' + (c.what ? '<p class="pl-co-what">' + esc(c.what) + '</p>' : '') +
      '<dl class="pl-co-dl">' + row('Industry', esc(c.industry)) + row('Revenue', esc(c.revenue)) + row('Employees', esc(c.employees)) + row('Headquarters', esc(c.hq)) + row('Founded', esc(c.founded)) +
      row('Website', c.website ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener">' + esc(host(c.website)) + '</a>' : '') + row('LinkedIn', c.linkedin ? '<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">Company page</a>' : '') + '</dl>' +
      (c.notes ? '<p class="pl-co-note"><b>Good to know</b> ' + esc(c.notes) + '</p>' : '') + '<p class="pl-co-src">From web research ' + esc(day(c.at)) + '. Revenue and size are estimates.' + ((c.sources || []).length ? ' Sources: ' + c.sources.slice(0, 3).map(function (u, i) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + (i + 1) + '</a>'; }).join(' ') : '') + '</p></div>';
  }
  function callSumHtml(l, u) {
    var c = callSumOf(l, u), x = l.intel && l.intel.calls && l.intel.calls[u];
    if (c) return '<div class="pl-csum"><b>Call summary</b>' + mdLite(c.summary) + '</div>';
    if (x && x.error) return '<small class="pl-via">No summary: ' + esc(x.error) + '</small>';
    return '';
  }
  function recSection(l) {
    var rs = recsOf(l);
    if (!rs.length && (l.sfCalls || []).length) return '<div class="pl-recs"><h3 class="pl-h" style="margin-top:0">Booking call <small class="ins-note" style="font-weight:400">from Salesfinity (Meeting Set)</small></h3>' + l.sfCalls.map(function (c) {
      return '<div class="pl-recs-row"><small>' + esc([c.rep, c.at ? day(c.at) : '', c.duration ? Math.round(c.duration / 60) + ' min' : ''].filter(Boolean).join(', ')) + '</small> ' + sfPlayer(c) + callSumHtml(l, 'sf:' + c.id) + '</div>';
    }).join('') + '</div>';
    if (!rs.length) return '';
    return '<div class="pl-recs"><h3 class="pl-h" style="margin-top:0">Booking call' + (rs.length > 1 ? 's' : '') + '</h3>' + rs.map(function (m) {
      return '<div class="pl-recs-row"><small>' + esc([m.sheet.caller || (m.callers || [])[0], m.created ? 'booked ' + day(m.created) : '', 'for ' + day(m.start)].filter(Boolean).join(', ')) + '</small> ' + recPlayer(m.sheet.recording) + callSumHtml(l, m.sheet.recording) + '</div>';
    }).join('') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pl-play-sf'); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    [].forEach.call(document.querySelectorAll('.pl-player audio'), function (a) { a.pause(); });
    var w = document.createElement('span'); w.innerHTML = '<span class="pl-player"><audio controls autoplay src="' + esc(b.getAttribute('data-sfrec')) + '"></audio>' + (b.getAttribute('data-sflink') ? '<a href="' + esc(b.getAttribute('data-sflink')) + '" target="_blank" rel="noopener">Open in Salesfinity</a>' : '') + '</span>'; b.replaceWith(w.firstChild);
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pl-play'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    [].forEach.call(document.querySelectorAll('.pl-player audio'), function (a) { a.pause(); });
    var w = document.createElement('span'); w.innerHTML = recPlayer(b.getAttribute('data-rec'), true); b.replaceWith(w.firstChild);
  }, true);
  document.addEventListener('error', function (e) {
    var a = e.target; if (!a || a.tagName !== 'AUDIO' || !a.closest('.pl-player')) return;
    a.insertAdjacentHTML('afterend', '<small class="pl-via">Can\'t play this one here.</small>'); a.remove();
  }, true);

  function delBtn(l, label) { return isAdmin() ? '<button type="button" class="pl-del" data-label="' + esc(label || 'Delete') + '" data-del-lead="' + esc(l.key) + '" aria-label="Delete ' + esc(l.name || 'lead') + '">' + esc(label || 'Delete') + '</button>' : ''; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-del-lead], [data-restore]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.hasAttribute('data-restore')) { b.disabled = true; api('POST', { action: 'lead-restore', key: b.getAttribute('data-restore') }).then(function () { return load(false); }).then(draw).catch(fail); return; }
    if (!b.getAttribute('data-sure')) {
      b.setAttribute('data-sure', '1'); b.classList.add('sure'); b.textContent = 'Click again to delete';
      setTimeout(function () { if (b.isConnected && !b.disabled) { b.removeAttribute('data-sure'); b.classList.remove('sure'); b.textContent = b.getAttribute('data-label') || 'Delete'; } }, 4000);
      return;
    }
    var l = leadByKey(b.getAttribute('data-del-lead')); if (!l) return;
    b.disabled = true; b.textContent = 'Deleting…';
    api('POST', { action: 'lead-delete', key: l.key, name: l.name, company: l.company, by: myName() }).then(function () { var d = $('pl-dialog'); if (d && d.open) d.close(); if (SEL === l.key) SEL = ''; return load(false); }).then(draw).catch(fail);
  }, true);

  /* ---------- Stages: every lead in one stage, side by side ---------- */
  var STAGES = [
    ['booked', 'Booked', 'var(--blue)', function (l) { return l.status === 'booked' || l.status === 'to_mark'; }, 'Meeting coming up, or to mark'],
    ['shown', 'Showed', 'var(--teal)', function (l) { return l.status === 'shown'; }, 'Had the meeting, following up'],
    ['no_show', 'No-show', 'var(--red)', function (l) { return l.status === 'no_show'; }, 'Missed the meeting'],
    ['no_reply', 'Not replying', '#7A6A55', function (l) { return deadBucket(l) === 'no_reply'; }, 'Stopped replying'],
    ['unqualified', 'Unqualified', '#6B7780', function (l) { return deadBucket(l) === 'unqualified'; }, 'Not a fit'],
    ['won', 'Won', 'var(--green)', function (l) { return l.status === 'won'; }, 'Closed']
  ];
  // Every lead is in exactly one stage (cancelled bookings and leads with no meeting yet are only under All leads).
  function stageCounts(leads) { var o = {}; STAGES.forEach(function (s) { o[s[0]] = leads.filter(s[3]).length; }); return o; }
  function hcardStage(k) { return k === 'no_reply' || k === 'unqualified' ? 'dead' : k; }
  function stageCard(l, st) {
    var line = '', last = lastNote(l), rs = recsOf(l), lm = l.lastMeeting;
    if (st === 'booked') line = l.status === 'to_mark' ? '<span class="pl-c-next late">Date passed, mark show or no-show</span>' : l.next ? '<span class="pl-c-next">Meeting ' + esc(when(l.next)) + '</span>' : '';
    else if (st === 'shown') line = l.nextStep ? '<span class="pl-c-next' + (overdue(l.nextStep) ? ' late' : '') + '">Next: ' + esc(l.nextStep.text) + (l.nextStep.due ? ', ' + esc(dueTxt(l.nextStep)) : '') + '</span>' : l.shownAt ? '<span class="pl-c-next">Showed ' + esc(day(l.shownAt)) + '</span>' : '';
    else if (st === 'no_show') line = lm ? '<span class="pl-c-next late">Missed ' + esc(day(lm.start)) + (l.noShows > 1 ? ', ' + l.noShows + ' times' : '') + '</span>' : '';
    else if (st === 'won') line = l.dealAt ? '<span class="pl-c-next">Won ' + esc(day(l.dealAt)) + '</span>' : '';
    return '<article class="pl-card" data-k="' + esc(l.key) + '" tabindex="0"><div class="pl-c-top"><b>' + esc(l.name || l.email || '(no name)') + '</b>' + hotTag(l.hot) + '</div>' +
      '<span class="pl-c-co">' + esc([l.company, (l.callers || [])[0]].filter(Boolean).join(', ')) + '</span>' + line +
      (st === 'shown' && last ? '<p class="pl-c-note">' + esc(last.text.slice(0, 110)) + (last.text.length > 110 ? '…' : '') + '</p>' : '') +
      '<div class="pl-c-foot">' + typeTag(l.type) + (rs.length ? playBtn(rs[rs.length - 1].sheet.recording, 'Play call', true) : '') + delBtn(l) + '</div></article>';
  }
  // One lead as a big horizontal card: who they are, where it stands, activity and actions.
  function hcard(l, st) {
    var last = lastNote(l), nx = l.nextStep, rs = recsOf(l), lm = l.lastMeeting, line = '', sm = summaryOf(l)[0], co = coOf(l), cs = sm ? null : latestCallSum(l);
    if (st === 'booked') line = l.status === 'to_mark' ? '<span class="pl-c-next late">Date passed' + (lm ? ' (' + esc(when(lm.start)) + ')' : '') + ', mark show or no-show</span>' : l.next ? '<span class="pl-c-next">Meeting ' + esc(when(l.next)) + '</span>' : '';
    else if (st === 'shown') line = nx ? '<span class="pl-c-next' + (overdue(nx) ? ' late' : '') + '">Next: ' + esc(nx.text) + (nx.due ? ', ' + esc(dueTxt(nx)) : '') + '</span>' : l.next ? '<span class="pl-c-next">Meeting ' + esc(when(l.next)) + '</span>' : '';
    else if (st === 'no_show') line = lm ? '<span class="pl-c-next late">Missed ' + esc(when(lm.start)) + (l.noShows > 1 ? ', ' + l.noShows + ' times' : '') + '</span>' : '';
    else if (st === 'won') line = l.dealAt ? '<span class="pl-c-next pl-c-won">Won ' + esc(day(l.dealAt)) + '</span>' : '';
    else if (st === 'dead') line = '<span class="pl-c-next late">' + (deadBucket(l) === 'unqualified' ? 'Unqualified' : 'Not replying') + (l.dealAt ? ' since ' + esc(day(l.dealAt)) : '') + '</span>';
    var nm = (l.meetings || []).length;
    var count = st === 'shown' ? '<b>' + (l.attempts || 0) + '</b> update' + (l.attempts === 1 ? '' : 's') + ' since the show' : '<b>' + nm + '</b> meeting' + (nm === 1 ? '' : 's');
    return '<article class="pl-hcard pl-hc-' + st + (st === 'shown' && l.temp ? ' pl-ht-' + l.temp : '') + '" data-k="' + esc(l.key) + '" tabindex="0">' +
      '<div class="pl-h-who"><div class="pl-h-name"><b>' + esc(l.name || l.email || '(no name)') + '</b>' + (st === 'shown' ? tempTag(l.temp) : '') + hotTag(l.hot) + '</div><span class="pl-c-co">' + esc([l.title, l.company].filter(Boolean).join(', ')) + '</span>' +
        (co && co.what ? '<span class="pl-h-what">' + esc(co.what.length > 150 ? co.what.slice(0, 147).replace(/\s+\S*$/, '') + '…' : co.what) + '</span>' : '') +
        (co && facts(co).length ? '<span class="pl-h-facts">' + facts(co).slice(0, 3).map(function (f) { return '<i>' + esc(f) + '</i>'; }).join('') + '</span>' : '') +
        '<span class="pl-h-meta">' + typeTag(l.type) + (l.callers[0] ? '<small>' + esc(l.callers.join(', ')) + '</small>' : '') + (l.shownAt ? '<small>Showed ' + esc(day(l.shownAt)) + '</small>' : l.lastBooked ? '<small>Booked ' + esc(day(l.lastBooked)) + '</small>' : '') + '</span></div>' +
      '<div class="pl-h-now">' + line +
        (last ? '<p class="pl-h-note">' + esc(last.text.slice(0, 260)) + (last.text.length > 260 ? '…' : '') + '<small>' + esc([last.by, ago(last.at)].filter(Boolean).join(', ')) + '</small></p>' : '<p class="pl-h-note pl-h-empty">No update yet</p>') +
        (sm ? '<p class="pl-h-sum"><b>Call summary, ' + esc(day(sm.start)) + '</b>' + esc(summaryGist(sm)) + '</p>' : cs ? '<p class="pl-h-sum"><b>Booking call summary</b>' + esc(bulletGist(cs.summary)) + '</p>' : '') + '</div>' +
      '<div class="pl-h-side">' + (st === 'shown' && isAdmin() ? tempSet(l) : '') + '<span class="pl-h-count">' + count + '</span>' + (l.lastActivity ? '<small' + (Date.now() - l.lastActivity > 14 * 864e5 ? ' class="late"' : '') + '>Last activity ' + esc(ago(l.lastActivity)) + '</small>' : '') +
        '<span class="pl-h-act">' + (rs.length ? playBtn(rs[rs.length - 1].sheet.recording, 'Play call', true) : (l.sfCalls || []).length ? sfPlayer(l.sfCalls[0], true) : '') + delBtn(l) + '</span></div></article>';
  }
  function tempSet(l) {
    return '<span class="pl-tset" role="group" aria-label="Hot, warm or cold">' + Object.keys(TEMP).map(function (k) { return '<button type="button" class="pl-tset-' + k + (l.temp === k ? ' on' : '') + '" data-temp-set="' + k + '" data-k="' + esc(l.key) + '" title="' + esc(TEMP[k][1]) + '" aria-pressed="' + (l.temp === k) + '">' + TEMP[k][0] + '</button>'; }).join('') + '</span>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-temp-set]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var l = leadByKey(b.getAttribute('data-k')); if (!l) return;
    var to = b.getAttribute('data-temp-set'); if (l.temp === to && l.tempSet) return;
    [].forEach.call(b.parentNode.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); x.disabled = true; });
    api('POST', { action: 'update', key: l.key, also: l.aliases || [], temp: to, by: myName() || 'Admin' }).then(function () { return load(false); }).then(draw).catch(fail);
  }, true);
  function bindHcards(root) {
    [].forEach.call(root.querySelectorAll('.pl-hcard'), function (c) {
      c.onclick = function (e) { if (e.target.closest('a, audio, .pl-player, .pl-tset')) return; SEL = c.getAttribute('data-k'); openLead(SEL); };
      c.onkeydown = function (e) { if (e.key === 'Enter') { SEL = c.getAttribute('data-k'); openLead(SEL); } };
    });
  }
  var STG = 'booked';
  try { STG = localStorage.getItem('bh_pl_stage') || 'booked'; } catch (e) {}
  function stagesView() {
    var q = F.q.trim().toLowerCase();
    var leads = DATA.leads.filter(matchesLead).filter(function (l) { return !q || [l.name, l.company, l.email].join(' ').toLowerCase().indexOf(q) > -1; });
    var dead = leads.filter(function (l) { return l.status === 'dead'; });
    var order = function (st) { return function (a, b) { return st === 'booked' ? (a.status === 'to_mark' ? 0 : 1) - (b.status === 'to_mark' ? 0 : 1) || t(a.next) - t(b.next) : st === 'shown' ? byTemp(a, b) : st === 'won' || st === 'no_reply' || st === 'unqualified' ? (b.dealAt || 0) - (a.dealAt || 0) : t(b.lastMeeting && b.lastMeeting.start) - t(a.lastMeeting && a.lastMeeting.start); }; };
    if (!STAGES.some(function (s) { return s[0] === STG; })) STG = 'booked';
    var cur = STAGES.filter(function (s) { return s[0] === STG; })[0];
    var rows = leads.filter(cur[3]).sort(order(cur[0]));
    return filters(false, false).replace(/<\/div>$/, (isAdmin() ? '<button type="button" id="pl-add" class="pl-add">+ Add a lead</button>' : '') + '</div>') +
      '<div class="pl-stagebar">' + STAGES.map(function (s, i) {
        var n = leads.filter(s[3]).length;
        return '<button type="button" class="pl-stg' + (s[0] === STG ? ' on' : '') + '" data-stg="' + s[0] + '" style="--c:' + s[2] + '"><span class="pl-stg-n">' + n + '</span><span class="pl-stg-t"><b>' + s[1] + '</b><small>' + esc(s[4]) + '</small></span></button>';
      }).join('') + '</div>' +
      '<div class="pl-hcards" style="--c:' + cur[2] + '">' + (rows.length ? rows.map(function (l) { return hcard(l, hcardStage(cur[0])); }).join('') : '<div class="card empty">Nobody in ' + esc(cur[1]) + ' right now.</div>') + '</div>' +
      '';
  }
  function bindStages() {
    bindHcards(MAIN);
    var add = $('pl-add'); if (add) add.onclick = function () { addLeadDialog(STG); };
    [].forEach.call(MAIN.querySelectorAll('[data-stg]'), function (b) { b.onclick = function () { STG = b.getAttribute('data-stg'); try { localStorage.setItem('bh_pl_stage', STG); } catch (e) {} draw(); }; });
    var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; var pos = q.selectionStart; draw(); var n = $('pl-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
  }

  /* ---------- No-shows and Dead ---------- */
  function simpleList(kind, bucket) {
    var q = F.q.trim().toLowerCase();
    var rows = DATA.leads.filter(matchesLead).filter(function (l) { return l.status === kind && (!bucket || deadBucket(l) === bucket) && (!q || [l.name, l.company, l.email].join(' ').toLowerCase().indexOf(q) > -1); })
      .sort(function (a, b) { return kind === 'dead' || kind === 'won' ? (b.dealAt || 0) - (a.dealAt || 0) : t(b.lastMeeting && b.lastMeeting.start) - t(a.lastMeeting && a.lastMeeting.start); });
    var note = kind === 'won' ? 'Closed and signed. Open one to see the full trail.' : kind === 'dead' ? (bucket === 'unqualified' ? 'Not a fit (budget, need or decision-maker). If they book again they come back by themselves.' : 'Not replying after many tries. If they book again they come back by themselves.') : 'Missed their meeting. When they rebook (Calendly or the sheet) they move back to Booked by themselves. Open one to log a follow-up or mark it dead.';
    return filters(false, false) + '<p class="ins-note" style="margin:-4px 0 10px"><b>' + rows.length + '</b>, ' + esc(note) + '</p>' +
      '<div class="pl-hcards" id="pl-leads">' + (rows.length ? rows.map(function (l) { return hcard(l, kind); }).join('') : '<div class="card empty">Nobody here.</div>') + '</div>';
  }

  /* ---------- All leads ---------- */
  function leadRows() {
    var q = F.q.trim().toLowerCase();
    return DATA.leads.filter(matchesLead).filter(function (l) {
      if (F.stage && l.status !== F.stage) return false;
      return !q || [l.name, l.company, l.email, l.title, l.latest].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function leadTable(shown) {
    return '<table><thead><tr><th>Came in</th><th>Lead</th><th>Source</th><th>Campaign, caller</th><th>Status</th><th>Latest</th><th>Meeting</th></tr></thead><tbody>' + shown.map(function (l) {
      var n = (l.meetings || []).length, ln = lastNote(l);
      var meet = l.next ? 'Next: ' + when(l.next) : (l.lastMeeting ? day(l.lastMeeting.start) + ', ' + (OUT[l.lastMeeting.outcome] || [''])[0] : '—');
      return '<tr data-k="' + esc(l.key) + '"><td>' + day(l.firstAt) + '</td><td><b>' + esc(l.name || l.email || '(no name)') + '</b><br><small>' + esc([l.title, l.company].filter(Boolean).join(', ')) + '</small></td><td>' + typeTag(l.type) + (l.origin ? '<br><small>' + esc(l.origin) + '</small>' : '') + '</td><td>' + esc(campaignOf(l) || '—') + (l.callers.length ? '<br><small>' + esc(l.callers.join(', ')) + '</small>' : '') + '</td><td>' + leadTag(l) + '</td><td class="pl-latest">' + esc(ln ? ln.text : (l.latest || '')) + '</td><td><small>' + esc(meet) + (n > 1 ? '<br>' + n + ' meetings' : '') + '</small></td></tr>';
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

  /* ---------- Lead detail ---------- */
  function dlg() {
    var d = $('pl-dialog');
    if (!d) { d = document.createElement('dialog'); d.id = 'pl-dialog'; d.className = 'pl-dialog'; document.body.appendChild(d); d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); }
    return d;
  }
  // Everything that happened with a lead, newest first: the team's updates plus meetings, sheet entries,
  // website forms and Fathom recordings, each with its date and time.
  function timeline(l, ms) {
    var ev = [];
    var OLD = { met: 'Showed', followup: 'Showed', proposal: 'Showed', negotiation: 'Showed', hold: 'Showed', lost: 'Dead', shown: 'Showed', won: 'Won', dead: 'Dead' };
    (l.trail || []).forEach(function (x) {
      if (x.kind === 'note') ev.push({ at: x.at, k: 'note', t: 'Note', body: x.text, by: x.by, id: x.id });
      else if (x.kind === 'stage') ev.push({ at: x.at, k: 'stage', t: x.to === 'auto' ? 'Brought back' : (x.to === 'dead' || x.to === 'lost') ? 'Moved to ' + (x.reason === 'unqualified' ? 'Unqualified' : 'Not replying') : 'Marked ' + (OLD[x.to] || x.to), by: x.by, c: x.to === 'dead' || x.to === 'lost' ? '#c0392b' : x.to === 'won' ? '#1e7a43' : '#0f7ac4' });
      else if (x.kind === 'next') ev.push({ at: x.at, k: 'next', t: 'Next follow-up: ' + x.text + (x.due ? ', ' + day(x.due + 'T12:00:00') : ''), by: x.by });
      else if (x.kind === 'email') ev.push({ at: x.at, k: 'note', t: 'Email sent to ' + (x.to || '') + ': ' + (x.subject || ''), body: (x.text || '') + ((x.files || []).length ? '\n\nAttached: ' + x.files.join(', ') : ''), by: x.by, c: '#2A6A9E' });
      else if (x.kind === 'edit') ev.push({ at: x.at, k: 'stage', t: x.text, by: x.by, c: '#8a9aa6' });
      else if (x.kind === 'temp') ev.push({ at: x.at, k: 'stage', t: TEMP[x.temp] ? 'Marked ' + TEMP[x.temp][0] + ' (' + TEMP[x.temp][1].toLowerCase() + ')' : 'Hot, warm or cold cleared', by: x.by, c: x.temp === 'hot' ? '#A3392D' : x.temp === 'warm' ? '#C28A0A' : x.temp === 'cold' ? '#2A6A9E' : '#8a9aa6' });
      else if (x.kind === 'hot') ev.push({ at: x.at, k: 'stage', t: x.hot && (HOT[x.hot] || OLD_HOT[x.hot]) ? 'Marked ' + (HOT[x.hot] || OLD_HOT[x.hot])[0] : 'Tag removed', by: x.by, c: x.hot && (HOT[x.hot] || OLD_HOT[x.hot]) ? (HOT[x.hot] || OLD_HOT[x.hot])[1] : '#8a9aa6' });
      else if (x.kind === 'next-done') ev.push({ at: x.at, k: 'next', t: 'Follow-up done' + (x.text ? ': ' + x.text : ''), by: x.by });
    });
    ms.forEach(function (m) {
      if (m.created && m.kind !== 'sheet') ev.push({ at: t(m.created), k: 'book', t: 'Booked ' + m.name + ' for ' + when(m.start), by: m.host ? 'with ' + m.host : '' });
      if (t(m.start) <= Date.now() || m.outcome === 'cancelled' || m.outcome === 'rescheduled') {
        var o = (OUT[m.outcome] || [m.outcome])[0];
        ev.push({ at: t(m.start), k: 'meet-' + m.outcome, t: (m.seq > 1 ? 'Follow-up meeting ' + m.seq : m.seq === 1 ? 'First meeting' : 'Meeting') + ': ' + o, body: m.name + (m.sheet && m.sheet.notes ? '\n' + m.sheet.notes : ''), link: m.fathom && m.fathom.url ? [m.fathom.url, 'Fathom recording'] : m.sheet && m.sheet.recording ? [m.sheet.recording, 'Booking call'] : null });
      }
    });
    (l.sheetRows || []).forEach(function (r) { if (t(r.at)) ev.push({ at: t(r.at), k: 'sheet', t: 'Booked by ' + (r.caller || 'a caller') + ' in ' + r.sheet + (r.appt ? ' for ' + when(r.appt) : ''), body: [r.trail || r.update, r.confirm && 'Confirmation: ' + r.confirm, r.show && 'Show status: ' + r.show].filter(Boolean).join('\n'), link: r.recording ? [r.recording, 'Booking call'] : null }); });
    (l.website || []).forEach(function (w) { ev.push({ at: t(w.at), k: 'web', t: 'Sent the ' + w.form + ' form', body: Object.keys(w.fields || {}).filter(function (k) { return !/^(eventId|button|cta|draftId)$/.test(k); }).map(function (k) { return k + ': ' + w.fields[k]; }).join('\n') }); });
    (l.recordings || []).forEach(function (r) { ev.push({ at: t(r.start), k: 'rec', t: 'Recorded call: ' + (r.title || 'Call') + (r.spoke ? '' : ' (prospect did not speak)'), body: r.summary ? r.summary.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') : '', fold: true, by: r.recordedBy, link: r.url ? [r.url, 'Watch in Fathom'] : null }); });
    if (l.note) ev.push({ at: l.firstAt || 0, k: 'note', t: 'Earlier note', body: l.note });
    return ev.filter(function (e) { return e.at; }).sort(function (a, b) { return b.at - a.at || (b.k === 'note' ? 1 : 0) - (a.k === 'note' ? 1 : 0); });
  }
  function timelineHtml(l, ev) {
    if (!ev.length) return '<div class="empty">Nothing yet.</div>';
    return '<ol class="pl-tl">' + ev.map(function (e) {
      var body = e.body ? (e.fold ? '<details><summary>Summary</summary><pre>' + esc(e.body) + '</pre></details>' : '<pre>' + esc(e.body) + '</pre>') : '';
      return '<li class="pl-tl-' + esc(e.k.split('-')[0]) + ' pl-tlk-' + esc(e.k) + '"' + (e.c ? ' style="--c:' + e.c + '"' : '') + '><time>' + esc(clock(e.at)) + '</time><div class="pl-tl-b"><b>' + esc(e.t) + '</b>' + (e.by ? ' <small class="pl-by">' + esc(e.by) + '</small>' : '') + body + (e.link ? '<a class="pl-rec" href="' + esc(e.link[0]) + '" target="_blank" rel="noopener">' + esc(e.link[1]) + '</a>' : '') + (e.id && isAdmin() ? '<button type="button" class="pl-tl-del" data-del="' + esc(e.id) + '" title="Delete this update">Delete</button>' : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  // A lead's update box and history, in the dialog or inside the given pane (Shown tab).
  function openLead(key, pane) {
    var l = leadByKey(key); if (!l) return;
    var ms = l.meetings.map(function (id) { return DATA.meetings.find(function (m) { return m.id === id; }); }).filter(Boolean);
    var row = function (k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>' : ''; };
    var ev = timeline(l, ms), nx = l.nextStep || {};
    var closed = l.status === 'dead' || l.status === 'won';
    var moves = closed ? '<button class="btn" type="button" data-deal="' + (l.shownAt ? 'shown' : '') + '">' + (l.shownAt ? 'Bring back to Showed' : 'Bring back') + '</button>'
      : (l.status === 'shown' ? '<button class="btn pl-b-won" type="button" data-deal="won">Won</button>' : '') + '<button class="btn pl-b-dead" type="button" data-deal="dead" data-r="no_reply">Not replying</button><button class="btn pl-b-dead" type="button" data-deal="dead" data-r="unqualified">Unqualified</button>';
    var d = pane || dlg(), q = function (id) { return d.querySelector('#' + id); };
    d.innerHTML = '<div class="dl">' + (pane ? '' : '<button class="x" type="button" aria-label="Close">×</button>') + '<div class="pl-dname"><h2>' + esc(l.name || l.email) + '</h2>' + (isAdmin() ? '<span class="pl-dact"><button type="button" class="btn pl-mail-btn" id="pl-m-open">Send email</button><button type="button" class="pl-edit-btn" id="pl-e-open">Edit contact</button></span>' : '') + '</div><div class="pl-dcontact">' + esc([l.title, l.company].filter(Boolean).join(', ')) + (l.phone ? '<span class="pl-dphone"><a href="tel:' + esc(l.phone.replace(/[^\d+]/g, '')) + '">' + esc(l.phone) + '</a></span>' : '') + (l.email ? '<span class="pl-dphone"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a></span>' : '') + '</div>' +
      (isAdmin() ? mailBox(l) : '') +
      (isAdmin() ? '<div class="pl-editbox" id="pl-e-box" hidden><label>Name<input type="text" id="pl-e-name" value="' + esc(l.name || '') + '"></label><label>Phone<input type="tel" id="pl-e-phone" value="' + esc(l.phone || '') + '"></label><label>Email<input type="email" id="pl-e-email" value="' + esc(l.email || '') + '"></label><label>Company<input type="text" id="pl-e-co" value="' + esc(l.company || '') + '"></label><div class="pl-editbox-act"><button type="button" class="btn pri" id="pl-e-save">Save</button><button type="button" class="btn" id="pl-e-cancel">Cancel</button><span class="ins-note" id="pl-e-msg" style="margin:0"></span></div></div>' : '') +
      '<div class="pl-dtags">' + typeTag(l.type) + leadTag(l) + tempTag(l.temp) + hotTag(l.hot) + (l.nextStep ? '<span class="pl-c-next' + (overdue(l.nextStep) ? ' late' : '') + '" style="margin:0">Next: ' + esc(l.nextStep.text) + (l.nextStep.due ? ', ' + esc(dueTxt(l.nextStep)) : '') + '</span>' : '') + (l.attempts ? '<small class="ins-note" style="margin:0;align-self:center">' + l.attempts + ' update' + (l.attempts === 1 ? '' : 's') + ' since the show</small>' : '') + '</div><div class="pl-dgrid"><div class="pl-dmain">' + coSection(l) + summarySection(l) + recSection(l) +
      (isAdmin() ? '<div class="pl-upd"><h3 class="pl-h" style="margin-top:0">Notes</h3><p class="ins-note" style="margin:-4px 0 8px">Each note goes on this lead\'s trail with the date, time and your name.</p><textarea id="pl-u-note" rows="3" placeholder="Type a note… e.g. Called twice, no answer. Sent a WhatsApp."></textarea>' +
        '<div class="pl-upd-row ' + (l.status === 'shown' ? 'pl-upd-5' : 'pl-upd-3') + '">' + (l.status === 'shown' ? '<label>Hot, warm or cold<select id="pl-u-temp">' + Object.keys(TEMP).map(function (k) { return '<option value="' + k + '"' + (l.temp === k ? ' selected' : '') + ' title="' + esc(TEMP[k][1]) + '">' + TEMP[k][0] + '</option>'; }).join('') + (l.temp ? '' : '<option value="" selected>Not set</option>') + '</select></label>' : '') + (l.status === 'shown' ? '<label>Where it stands<select id="pl-u-hot"><option value="">—</option>' + Object.keys(HOT).map(function (k) { return '<option value="' + k + '"' + (l.hot === k ? ' selected' : '') + '>' + esc(HOT[k][0]) + '</option>'; }).join('') + '</select></label>' : '') + '<label>Next follow-up<input type="text" id="pl-u-next" value="' + esc(nx.text || '') + '" placeholder="Call again"></label><label>On<input type="date" id="pl-u-due" value="' + esc(nx.due || '') + '"></label><label>Your name<input type="text" id="pl-u-by" value="' + esc(myName()) + '" placeholder="Amr"></label></div>' +
        '<div class="pl-upd-act"><button class="btn pri" id="pl-u-save" type="button">Add note</button>' + (l.nextStep ? '<button class="btn" id="pl-u-done" type="button">Follow-up done</button>' : '') + '<span class="pl-moves">' + moves + delBtn(l, 'Delete lead') + '</span><span id="pl-u-msg" class="ins-note" style="margin:0"></span></div></div>' : '') +
      '</div>' +
      '<aside class="pl-dtrail"><h3 class="pl-h">Trail <small class="ins-note" style="font-weight:400">newest first</small></h3>' + timelineHtml(l, ev) + '</aside></div>' +
      (ms.length ? '<h3 class="pl-h">Meetings</h3><div class="pl-table">' + meetingTable(ms, false) + '</div>' : '') +
      '<details class="pl-more"><summary>Contact details</summary><dl>' + row('Email', l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '') + row('Phone', esc(l.phone)) + row('Also booked as', esc((l.aliases || []).map(function (k) { var v = k.slice(2).split('|'); return v[0] + (v[1] ? ' (' + v[1] + ')' : ''); }).join(', '))) + row('Country', esc(l.country)) + row('Came in', when(l.firstAt)) + row('How', esc(l.origin)) + row('Campaign', esc(l.campaigns.join(', '))) + row('Caller', esc(l.callers.join(', '))) + '</dl>' +
      (isAdmin() ? '<div class="pl-edit" style="margin-top:14px"><label>Source<select id="pl-d-type"><option value="">Automatic</option><option value="inbound"' + (l.typeOverride === 'inbound' ? ' selected' : '') + '>Inbound</option><option value="outbound"' + (l.typeOverride === 'outbound' ? ' selected' : '') + '>Outbound</option></select></label><div style="align-self:end"><button class="btn" id="pl-d-save" type="button">Save source</button> <span id="pl-d-msg" class="ins-note"></span></div></div>' : '') + '</details>' + '</div>';
    if (!pane) d.querySelector('.x').onclick = function () { d.close(); };
    bindMeetings(d);
    [].forEach.call(d.querySelectorAll('tr[data-k]'), function (tr) { tr.onclick = null; });
    var reopen = function () { return load(false).then(function () { draw(); if (!pane && d.open) openLead(key); }); };
    var by = function () { var v = q('pl-u-by').value.trim(); setMyName(v); return v; };
    var send = function (b, extra) {
      b.disabled = true; q('pl-u-msg').textContent = 'Saving…';
      api('POST', Object.assign({ action: 'update', key: l.key, also: l.aliases || [], note: q('pl-u-note').value, by: by(), next: { text: q('pl-u-next').value, due: q('pl-u-due').value } }, q('pl-u-hot') && q('pl-u-hot').value !== (l.hot || '') ? { hot: q('pl-u-hot').value } : {}, q('pl-u-temp') && q('pl-u-temp').value && (q('pl-u-temp').value !== l.temp || !l.tempSet) ? { temp: q('pl-u-temp').value } : {}, extra)).then(function (r) { if (r && r.changed === 0) { q('pl-u-msg').textContent = 'Type a note first.'; b.disabled = false; q('pl-u-note').focus(); return; } return reopen(); }).catch(function (e) { q('pl-u-msg').textContent = e.message; b.disabled = false; });
    };
    if (q('pl-u-save')) q('pl-u-save').onclick = function () { send(this, {}); };
    if (q('pl-u-note')) q('pl-u-note').onkeydown = function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(q('pl-u-save'), {}); } };
    if (q('pl-u-done')) q('pl-u-done').onclick = function () { send(this, { next: { text: '', due: '' } }); };
    [].forEach.call(d.querySelectorAll('[data-deal]'), function (b) { b.onclick = function () { send(b, { deal: b.getAttribute('data-deal'), reason: b.getAttribute('data-r') || '', from: l.status }); }; });
    [].forEach.call(d.querySelectorAll('[data-del]'), function (b) {
      b.onclick = function () { if (!b.getAttribute('data-sure')) { b.setAttribute('data-sure', '1'); b.textContent = 'Click again to delete'; return; } b.disabled = true; api('POST', { action: 'note-delete', key: l.key, also: l.aliases || [], id: b.getAttribute('data-del') }).then(reopen).catch(fail); };
    });
    if (q('pl-m-open')) {
      q('pl-m-open').onclick = function () { q('pl-m-box').hidden = false; q('pl-m-open').hidden = true; (q('pl-m-to').value ? q('pl-m-body') : q('pl-m-to')).focus(); };
      q('pl-m-cancel').onclick = function () { q('pl-m-box').hidden = true; q('pl-m-open').hidden = false; };
      var mailto = function () { q('pl-m-app').href = 'mailto:' + encodeURIComponent(q('pl-m-to').value.trim()) + '?subject=' + encodeURIComponent(q('pl-m-subj').value) + '&body=' + encodeURIComponent(q('pl-m-body').value) + (q('pl-m-cc').value.trim() ? '&cc=' + encodeURIComponent(q('pl-m-cc').value.trim()) : ''); };
      ['pl-m-to', 'pl-m-subj', 'pl-m-body', 'pl-m-cc'].forEach(function (id) { q(id).oninput = mailto; }); mailto();
      var files = [];
      var kb = function (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
      var drawFiles = function () {
        var total = files.reduce(function (n, f) { return n + f.size; }, 0);
        q('pl-m-list').innerHTML = files.map(function (f, i) { return '<li>' + esc(f.name) + ' <small>' + kb(f.size) + '</small> <button type="button" data-rm="' + i + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></li>'; }).join('') + (total > 3 * 1048576 ? '<li class="late">Too big: ' + kb(total) + ' in total, 3 MB at most</li>' : '');
        [].forEach.call(q('pl-m-list').querySelectorAll('[data-rm]'), function (x) { x.onclick = function () { files.splice(+x.getAttribute('data-rm'), 1); drawFiles(); }; });
      };
      q('pl-m-file').onchange = function () { [].forEach.call(this.files, function (f) { if (files.length < 5) files.push(f); }); this.value = ''; drawFiles(); };
      var read = function (f) { return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok({ name: f.name, content: String(r.result).replace(/^data:[^,]*,/, '') }); }; r.onerror = function () { no(new Error('Could not read ' + f.name)); }; r.readAsDataURL(f); }); };
      q('pl-m-send').onclick = function () {
        var b = this;
        if (files.reduce(function (n, f) { return n + f.size; }, 0) > 3 * 1048576) { q('pl-m-msg').textContent = 'Attachments are too big (3 MB in total at most).'; return; }
        b.disabled = true; q('pl-m-msg').textContent = files.length ? 'Uploading and sending…' : 'Sending…';
        var from = q('pl-m-from').value.trim(); if (from) setMyName(from);
        Promise.all(files.map(read)).then(function (att) {
          return api('POST', { action: 'email-send', key: l.key, also: l.aliases || [], to: q('pl-m-to').value.trim(), toName: l.name || '', cc: q('pl-m-cc').value, replyTo: q('pl-m-reply').value, copy: q('pl-m-copy').checked, fromName: from, subject: q('pl-m-subj').value, body: q('pl-m-body').value, attachments: att, by: from || 'Admin' });
        }).then(function () { q('pl-m-msg').textContent = 'Sent.'; return reopen(); }).catch(function (e) { q('pl-m-msg').textContent = e.message; b.disabled = false; });
      };
    }
    if (q('pl-e-open')) {
      q('pl-e-open').onclick = function () { q('pl-e-box').hidden = false; q('pl-e-open').hidden = true; q('pl-e-name').focus(); };
      q('pl-e-cancel').onclick = function () { q('pl-e-box').hidden = true; q('pl-e-open').hidden = false; };
      q('pl-e-save').onclick = function () {
        var b = this, name = q('pl-e-name').value.trim();
        if (!name) { q('pl-e-msg').textContent = 'Enter a name.'; q('pl-e-name').focus(); return; }
        b.disabled = true; q('pl-e-msg').textContent = 'Saving…';
        api('POST', { action: 'update', key: l.key, also: l.aliases || [], by: myName() || 'Admin', contact: (function () { var c = {}, ph = q('pl-e-phone').value.trim(), co = q('pl-e-co').value.trim(), em = q('pl-e-email').value.trim(); if (em !== (l.email || '')) c.email = em; if (name !== (l.name || '')) c.name = name; if (ph !== (l.phone || '')) c.phone = ph; if (co !== (l.company || '')) c.company = co; return c; })() })
          .then(reopen).catch(function (e) { q('pl-e-msg').textContent = e.message; b.disabled = false; });
      };
    }
    if (q('pl-d-save')) q('pl-d-save').onclick = function () {
      var b = this; b.disabled = true; q('pl-d-msg').textContent = 'Saving…';
      api('POST', { action: 'lead', key: l.key, also: l.aliases || [], type: q('pl-d-type').value }).then(reopen).catch(function (e) { q('pl-d-msg').textContent = e.message; b.disabled = false; });
    };
    if (!pane && !d.open) d.showModal();
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
          '<small class="pl-src-st">' + (f ? (f.error ? 'Problem: ' + esc(f.error) : f.rows + ' rows, synced ' + ago(f.syncedAt)) : 'Not synced yet') + '</small></div>';
      }).join('') + '<div class="pl-src-foot"><button type="button" class="btn" id="pl-src-add">+ Add a sheet</button><button type="button" class="btn pri" id="pl-src-save">Save sources</button><span id="pl-src-msg" class="ins-note" style="margin:0"></span></div></div>' +
      sinceCard() + deletedCard() + eventTypesCard() +
      '<p class="ins-note">Columns are found by their names (Prospect Name, Business Name, Agent Name, Appointment Date, Appointment Time, Timezone, Prospect Email, Call Recording Link, Confirmation Status, Show Status…), so you can add or move columns. If a row has its own Timezone (EST, GST…), that wins over the time zone above.</p>';
  }
  function sinceCard() {
    var v = DATA.status.since || '';
    return '<h3 class="pl-h" style="margin-top:22px">Start date</h3><p class="sub" style="margin-top:-4px">Meetings and leads before this date are left out of the Pipeline. Leave it empty to show everything.</p>' +
      '<div class="card pl-ev" style="padding:14px 16px"><div class="pl-upd-act" style="margin:0"><label style="display:flex;gap:10px;align-items:center;font-weight:600">Count from <input type="date" id="pl-since" value="' + esc(v) + '" style="height:38px;padding:0 10px;border:1px solid #CBD4D9;border-radius:4px"></label><button type="button" class="btn pri" id="pl-since-save">Save start date</button><span id="pl-since-msg" class="ins-note" style="margin:0"></span></div></div>';
  }
  function deletedCard() {
    var list = DATA.status.deleted || [];
    if (!list.length) return '';
    return '<h3 class="pl-h" style="margin-top:22px">Deleted leads</h3><p class="sub" style="margin-top:-4px">Left out of the Pipeline. Their notes are kept, so you can bring any of them back. If one books again, they come back by themselves.</p>' +
      '<div class="card pl-ev">' + list.map(function (d) { return '<div class="pl-ev-row" style="cursor:default"><span><b>' + esc(d.name || '(no name)') + '</b>' + (d.company ? ', ' + esc(d.company) : '') + '</span><small>Deleted ' + esc(day(d.at)) + (d.by ? ' by ' + esc(d.by) : '') + '</small><button type="button" class="btn" data-restore="' + esc(d.key) + '">Bring back</button></div>'; }).join('') + '</div>';
  }
  function eventTypesCard() {
    var list = (DATA.status.calendly && DATA.status.calendly.eventTypes) || [];
    if (!list.length) return '';
    return '<h3 class="pl-h" style="margin-top:22px">Calendly event types</h3><p class="sub" style="margin-top:-4px">Untick the ones that are not sales calls (job interviews, vendor calls…). They are left out of leads, meetings and the show rate.</p>' +
      '<div class="card pl-ev">' + list.map(function (e) { return '<label class="pl-ev-row"><input type="checkbox" data-ev="' + esc(e.name) + '"' + (e.skipped ? '' : ' checked') + '> <span>' + esc(e.name || '(no name)') + '</span><small>' + e.meetings + ' meeting' + (e.meetings === 1 ? '' : 's') + '</small></label>'; }).join('') +
      '<div class="pl-src-foot"><button type="button" class="btn pri" id="pl-ev-save">Save event types</button><span id="pl-ev-msg" class="ins-note" style="margin:0"></span></div></div>';
  }
  function bindSources() {
    if ($('pl-since-save')) $('pl-since-save').onclick = function () {
      var b = this; b.disabled = true; $('pl-since-msg').textContent = 'Saving…';
      api('POST', { action: 'since', since: $('pl-since').value }).then(function () { return load(false); }).then(function () { draw(); $('pl-since-msg').textContent = 'Saved.'; }).catch(function (e) { $('pl-since-msg').textContent = e.message; b.disabled = false; });
    };
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
    var body = SUB === 'stages' ? stagesView() : SUB === 'won' ? simpleList('won') : SUB === 'booked' ? bookedView() : SUB === 'shown' ? shownView() : SUB === 'noshow' ? simpleList('no_show') : SUB === 'noreply' ? simpleList('dead', 'no_reply') : SUB === 'unqualified' ? simpleList('dead', 'unqualified') : SUB === 'leads' ? leadsView() : SUB === 'view' ? viewPage() : SUB === 'sources' ? sourcesView() : SUB === 'team' ? teamView() : dashboard();
    MAIN.innerHTML = head() + body;
    bindFilters();
    if (SUB === 'leads') drawLeadsTable();
    if (SUB === 'shown') bindShown();
    if (SUB === 'stages') bindStages();
    if ((SUB === 'noshow' || SUB === 'won' || SUB === 'noreply' || SUB === 'unqualified') && $('pl-leads')) { bindHcards($('pl-leads')); var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; var pos = q.selectionStart; draw(); var n = $('pl-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }; }
    if (!SUB) bindStageTiles();
    if (SUB === 'sources') bindSources();
    if (SUB === 'team') bindTeam(); else LAST_INVITE = null;
    bindMeetings(MAIN);
    var d = $('pl-dialog'); if (d && d.open) bindMeetings(d);
    runIntel();
  }
  // Company profiles and call summaries are made in the background while the admin is open, a few leads at a time.
  var INTEL = { running: false, calls: 0 };
  function intelNote() {
    var st = DATA.status && DATA.status.intel; if (!st || !st.pausedUntil || st.pausedUntil < Date.now()) return '';
    return '<div class="pl-intel-note" role="status">Company info and call summaries are paused: ' + esc(st.error || 'the AI service refused') + ' <button type="button" class="btn" id="pl-intel-retry">Retry now</button></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#pl-intel-retry'); if (!b) return;
    b.disabled = true; b.textContent = 'Working…'; DATA.status.intel = {}; INTEL.calls = 0; runIntel(true);
  });
  function runIntel(force) {
    if (INTEL.running || !isAdmin() || !DATA || INTEL.calls >= 40) return;
    var st = DATA.status && DATA.status.intel; if (!force && st && st.pausedUntil && st.pausedUntil > Date.now()) return;
    INTEL.running = true; INTEL.calls++;
    var keys = DATA.leads.filter(function (l) { return ['booked', 'to_mark', 'shown', 'no_show'].indexOf(l.status) > -1; }).map(function (l) { return l.key; });
    api('POST', { action: 'intel', keys: keys, force: Boolean(force) }).then(function (r) {
      INTEL.running = false;
      Object.keys((r && r.done) || {}).forEach(function (k) {
        var l = leadByKey(k); if (!l) return; l.intel = r.done[k];
        var card = MAIN && MAIN.querySelector('.pl-hcard[data-k="' + k.replace(/["\\]/g, '\\$&') + '"]');
        if (card) { var m = /pl-hc-(\w+)/.exec(card.className), w = document.createElement('div'); w.innerHTML = hcard(l, m ? m[1] : 'booked'); card.replaceWith(w.firstChild); bindHcards(MAIN); }
      });
      var note = document.querySelector('.pl-intel-note');
      if (r && r.paused) { DATA.status.intel = { error: r.error || '', pausedUntil: Date.now() + 3600e3 }; if (note) note.outerHTML = intelNote(); return; }
      if (note) note.remove();
      if (r && r.remaining > 0) setTimeout(runIntel, 1500);
    }, function () { INTEL.running = false; });
  }
  var OLD_ROUTES = { opps: 'shown', meetings: 'booked', dead: 'noreply' };
  function route(parts, main) {
    var p = OLD_ROUTES[parts[0]] || parts[0];
    MAIN = main; SUB = ['stages', 'won', 'booked', 'shown', 'noshow', 'noreply', 'unqualified', 'leads', 'view', 'sources', 'team'].indexOf(p) > -1 ? p : ''; VIEW = SUB === 'view' ? (parts[1] || '') : '';
    if (MAIN) MAIN.scrollTop = 0;
    if (DATA) { draw(); return; }
    main.innerHTML = '<h1>Pipeline</h1><div class="empty">Loading leads and meetings…</div>';
    (LOADING || load()).then(draw).catch(function (e) { main.innerHTML = '<h1>Pipeline</h1><div class="note">' + esc(e.message) + '</div>'; });
  }
  function nav() { return '<a href="#pipeline">Pipeline</a>'; }
  window.BH_PIPELINE = { route: route, nav: nav };
})();
