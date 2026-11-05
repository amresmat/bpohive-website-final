// Admin "Pipeline": every lead (website forms + the callers' Hot Leads sheets) and every Calendly
// meeting in one place, with one-click Showed / No-show / Rescheduled / Cancelled.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var DATA = null, MAIN = null, SUB = '', LOADING = null;
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
    var line = (c.connected ? 'Calendly synced ' + ago(c.lastSync) : 'Calendly not connected') + ' · ' + (sh.files.length ? 'Sheets synced ' + ago(sh.lastSync) : 'Sheets not connected') + ' · Website forms live';
    var needs = DATA.meetings.filter(function (m) { return m.outcome === 'needs'; }).length;
    return '<div class="ins-head"><div><h1>Pipeline</h1><p class="sub">Every inbound and outbound lead, and every Calendly meeting. <span class="pl-sync">' + esc(line) + '</span></p></div><div class="bar" style="margin:0"><button class="btn" id="pl-refresh" type="button">Refresh</button></div></div>' +
      setup() +
      '<div class="tabs">' + [['', 'Dashboard', ''], ['leads', 'Leads', DATA.leads.length], ['meetings', 'Meetings', needs ? needs + ' to mark' : '']].map(function (x) { return '<a class="tab' + (SUB === x[0] ? ' on' : '') + '" href="#pipeline' + (x[0] ? '/' + x[0] : '') + '">' + x[1] + (x[2] !== '' ? '<b>' + esc(x[2]) + '</b>' : '') + '</a>'; }).join('') + '</div>';
  }
  function setup() {
    var s = DATA.status, bits = [];
    if (!s.calendly.connected) bits.push('<li><b>Calendly:</b> not connected yet. Add your Calendly key as <code>CALENDLY_TOKEN</code> in Vercel (Settings → Environment Variables), then redeploy.</li>');
    else if (s.calendly.error) bits.push('<li><b>Calendly:</b> last sync failed: ' + esc(s.calendly.error) + '</li>');
    if (!s.sheets.files.length) bits.push('<li><b>Callers\' Google Sheets:</b> not connected yet. The "BPO Hive Pipeline sync" Google script sends them here every 15 minutes once it is switched on.</li>');
    s.sheets.files.forEach(function (f) { if (f.error) bits.push('<li><b>' + esc(f.title) + ':</b> could not be read (' + esc(f.error) + ')</li>'); });
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
      '<select id="pl-caller">' + opts(callers, F.caller, 'All callers') + '</select>' +
      (withStage ? '<select id="pl-stage">' + '<option value="">Every stage</option>' + Object.keys(STAGE).map(function (k) { return '<option value="' + k + '"' + (F.stage === k ? ' selected' : '') + '>' + STAGE[k][0] + '</option>'; }).join('') + '</select>' : '') +
      '</div>';
  }
  function bindFilters() {
    [['pl-range', 'range', true], ['pl-type', 'type'], ['pl-campaign', 'campaign'], ['pl-caller', 'caller'], ['pl-stage', 'stage']].forEach(function (x) { var el = $(x[0]); if (el) el.onchange = function () { F[x[1]] = x[2] ? +el.value : el.value; draw(); }; });
    var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; drawLeadsTable(); };
    var rf = $('pl-refresh'); if (rf) rf.onclick = function () { rf.disabled = true; rf.textContent = 'Syncing…'; api('POST', { action: 'sync' }).catch(function () {}).then(function () { return load(false); }).then(draw).catch(fail); };
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
  function dashboard() {
    var leads = DATA.leads.filter(matchesLead).filter(function (l) { return inRange(l.firstAt); });
    var ms = DATA.meetings.filter(matchesMeeting);
    var booked = ms.filter(function (m) { return inRange(m.created); });
    var held = ms.filter(function (m) { return inRange(m.start) && t(m.start) < Date.now() && ['showed', 'no_show', 'needs'].indexOf(m.outcome) > -1; });
    var showed = held.filter(function (m) { return m.outcome === 'showed'; }).length, noshow = held.filter(function (m) { return m.outcome === 'no_show'; }).length;
    var needs = ms.filter(function (m) { return m.outcome === 'needs'; }).length;
    var inb = leads.filter(function (l) { return l.type === 'inbound'; }).length;
    var won = DATA.leads.filter(matchesLead).filter(function (l) { return l.stage === 'won'; }).length;
    var tiles = [['New leads', leads.length, inb + ' inbound · ' + (leads.length - inb) + ' outbound'], ['Meetings booked', booked.length, 'booked in this period'], ['Showed', showed, 'of ' + held.length + ' held'], ['No-show', noshow, ''], ['Show rate', showed + noshow ? pct(showed, showed + noshow) + '%' : '—', 'of marked meetings'], ['Needs marking', needs, needs ? '<a href="#pipeline/meetings">Mark them →</a>' : 'all caught up'], ['Won', won, 'all time']];
    var upcoming = ms.filter(function (m) { return m.outcome === 'upcoming' && t(m.start) < Date.now() + 7 * 864e5; }).sort(function (a, b) { return t(a.start) - t(b.start); });
    var weeks = 12;
    var lc = weekly(DATA.leads.filter(matchesLead), function (l) { return l.firstAt; }, function (l) { return l.type; }, weeks);
    var mc = weekly(ms.filter(function (m) { return t(m.start) < Date.now(); }), function (m) { return t(m.start); }, function (m) { return m.outcome; }, weeks);
    return filters(true, false) +
      '<div class="ins-tiles">' + tiles.map(function (x) { return '<div class="ins-tile"><small>' + x[0] + '</small><b>' + x[1] + '</b><span>' + (x[0] === 'Needs marking' ? x[2] : esc(x[2])) + '</span></div>'; }).join('') + '</div>' +
      '<div class="ins-grid">' + bars(lc, [['inbound', 'Inbound', '#0f7ac4'], ['outbound', 'Outbound', '#1B7381']], 'New leads per week') +
      bars(mc, [['showed', 'Showed', '#1e7a43'], ['no_show', 'No-show', '#c0392b'], ['needs', 'Not marked yet', '#e0a526'], ['rescheduled', 'Rescheduled', '#9fb2bf'], ['cancelled', 'Cancelled', '#cfd9e0']], 'Meetings per week') + '</div>' +
      '<div class="card ins-table" style="margin-bottom:14px"><h3>Next 7 days</h3>' + (upcoming.length ? meetingTable(upcoming, true) : '<div class="empty">No meetings booked for the next 7 days.</div>') + '</div>' +
      breakdown('By campaign', 'Campaign', function (l) { return (l.campaigns || []).length ? l.campaigns : [l.type === 'inbound' ? 'Booked on Calendly directly' : 'Outbound']; }) +
      '<div style="height:14px"></div>' + breakdown('By caller', 'Caller', function (l) { return (l.callers || []).length ? l.callers : [l.type === 'inbound' ? 'Inbound (no caller)' : 'Unassigned']; });
  }

  /* ---------- Leads ---------- */
  function leadRows() {
    var q = F.q.trim().toLowerCase();
    return DATA.leads.filter(matchesLead).filter(function (l) {
      if (F.stage && l.stage !== F.stage) return false;
      return !q || [l.name, l.company, l.email, l.title, l.latest].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  function drawLeadsTable() {
    var rows = leadRows(), shown = rows.slice(0, 400);
    var el = $('pl-leads'); if (!el) return;
    el.innerHTML = rows.length ? '<table><thead><tr><th>Came in</th><th>Lead</th><th>Type</th><th>Campaign · caller</th><th>Stage</th><th>Latest</th><th>Meeting</th></tr></thead><tbody>' + shown.map(function (l, i) {
      var meet = l.next ? 'Next: ' + when(l.next) : (l.lastMeeting ? day(l.lastMeeting.start) + ' · ' + (OUT[l.lastMeeting.outcome] || [''])[0] : '—');
      return '<tr data-k="' + esc(l.key) + '"><td>' + day(l.firstAt) + '</td><td><b>' + esc(l.name || l.email || '(no name)') + '</b><br><small>' + esc([l.title, l.company].filter(Boolean).join(' · ')) + '</small></td><td>' + typeTag(l.type) + '</td><td>' + esc(campaignOf(l) || '—') + (l.callers.length ? '<br><small>' + esc(l.callers.join(', ')) + '</small>' : '') + '</td><td>' + tag(STAGE, l.stage) + '</td><td class="pl-latest">' + esc(l.latest || '') + '</td><td><small>' + esc(meet) + '</small></td></tr>';
    }).join('') + '</tbody></table>' + (rows.length > shown.length ? '<p class="ins-note" style="padding:0 16px 12px">Showing the newest 400 of ' + rows.length + '. Search or filter to narrow it down.</p>' : '') : '<div class="empty">No leads match.</div>';
    $('pl-count').textContent = rows.length + ' lead' + (rows.length === 1 ? '' : 's');
    [].forEach.call(el.querySelectorAll('tbody tr'), function (tr) { tr.onclick = function () { openLead(tr.getAttribute('data-k')); }; });
  }
  function leadsView() { return filters(false, true) + '<p class="ins-note" id="pl-count" style="margin:-4px 0 10px"></p><div class="card tablewrap pl-table" id="pl-leads"></div>'; }

  /* ---------- Meetings ---------- */
  function outcomeButtons(m) {
    if (m.outcome === 'upcoming') return '<div class="pl-outs">' + BTNS.slice(2).map(function (b) { return '<button type="button" class="mini" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>';
    return '<div class="pl-outs">' + BTNS.map(function (b) { return '<button type="button" class="mini pl-o-' + b[0] + (m.outcome === b[0] ? ' on' : '') + '" data-m="' + esc(m.id) + '" data-o="' + b[0] + '">' + b[1] + '</button>'; }).join('') + (!m.auto ? '<button type="button" class="mini pl-undo" data-m="' + esc(m.id) + '" data-o="clear" title="Go back to what Calendly says">Undo</button>' : '') + '</div>';
  }
  function meetingTable(rows, compact) {
    return '<table><thead><tr><th>When</th><th>Who</th><th>Type</th><th>Meeting</th><th>' + (compact ? 'Status' : 'Outcome') + '</th></tr></thead><tbody>' + rows.map(function (m) {
      var who = m.invitee.name || m.invitee.email || '(unknown)';
      return '<tr class="pl-m-' + m.outcome + '" data-k="' + esc(m.leadKey || '') + '"><td class="pl-when">' + when(m.start) + '</td><td><b>' + esc(who) + '</b><br><small>' + esc([m.company, m.invitee.email].filter(Boolean).join(' · ')) + '</small></td><td>' + typeTag(m.type) + (m.callers.length ? '<br><small>' + esc(m.callers.join(', ')) + '</small>' : '') + '</td><td>' + esc(m.name) + (m.host ? '<br><small>with ' + esc(m.host) + '</small>' : '') + '</td><td>' + tag(OUT, m.outcome) + (compact ? '' : outcomeButtons(m)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function meetingsView() {
    var ms = DATA.meetings.filter(matchesMeeting), now = Date.now();
    var groups = { needs: ms.filter(function (m) { return m.outcome === 'needs'; }), upcoming: ms.filter(function (m) { return m.outcome === 'upcoming'; }).sort(function (a, b) { return t(a.start) - t(b.start); }), past: ms.filter(function (m) { return t(m.start) < now && m.outcome !== 'needs'; }), all: ms };
    if (!F.mtab) F.mtab = groups.needs.length ? 'needs' : 'upcoming';
    var rows = groups[F.mtab] || [];
    return filters(false, false).replace('<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">', '') +
      '<div class="tabs pl-mtabs">' + [['needs', 'Needs marking'], ['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(function (x) { return '<button type="button" class="tab' + (F.mtab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '">' + x[1] + '<b>' + groups[x[0]].length + '</b></button>'; }).join('') + '</div>' +
      (F.mtab === 'needs' && rows.length ? '<p class="ins-note" style="margin:-4px 0 10px">These meetings already happened. Mark each one so the show rate stays right. No-show is also flagged in Calendly.</p>' : '') +
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
    var trail = l.sheetRows.map(function (r) { return '<div class="pl-trail"><small>' + esc(r.sheet) + (r.at ? ' · added ' + esc(r.at) : '') + '</small><pre>' + esc(r.trail || r.update || '') + '</pre></div>'; }).join('');
    var forms = l.website.map(function (w) { return '<div class="pl-trail"><small>' + esc(w.form) + ' · ' + when(w.at) + (w.page ? ' · ' + esc(String(w.page).replace(/^https?:\/\/[^/]+/, '')) : '') + '</small><pre>' + esc(Object.keys(w.fields || {}).filter(function (k) { return !/^(eventId|button|cta|draftId)$/.test(k); }).map(function (k) { return k + ': ' + w.fields[k]; }).join('\n')) + '</pre></div>'; }).join('');
    var d = dlg();
    d.innerHTML = '<div class="dl"><button class="x" type="button" aria-label="Close">×</button><h2>' + esc(l.name || l.email) + '</h2><div style="color:#5d7280">' + esc([l.title, l.company].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="pl-dtags">' + typeTag(l.type) + tag(STAGE, l.stage) + '</div>' +
      '<dl>' + row('Email', l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '') + row('Phone', esc(l.phone)) + row('Came in', when(l.firstAt)) + row('Campaign', esc(l.campaigns.join(', '))) + row('Caller', esc(l.callers.join(', '))) + row('Latest', esc(l.latest)) + '</dl>' +
      (ms.length ? '<h3 class="pl-h">Meetings</h3><div class="pl-table">' + meetingTable(ms, false) + '</div>' : '') +
      (trail ? '<h3 class="pl-h">Caller notes</h3>' + trail : '') + (forms ? '<h3 class="pl-h">Website forms</h3>' + forms : '') +
      '<h3 class="pl-h">Your update</h3><div class="pl-edit"><label>Stage<select id="pl-d-stage"><option value="">Automatic</option><option value="won"' + (l.stageOverride === 'won' ? ' selected' : '') + '>Won (became a client)</option><option value="lost"' + (l.stageOverride === 'lost' ? ' selected' : '') + '>Lost</option></select></label>' +
      '<label>Type<select id="pl-d-type"><option value="">Automatic</option><option value="inbound"' + (l.typeOverride === 'inbound' ? ' selected' : '') + '>Inbound</option><option value="outbound"' + (l.typeOverride === 'outbound' ? ' selected' : '') + '>Outbound</option></select></label>' +
      '<label class="pl-note">Notes<textarea id="pl-d-note" rows="3" placeholder="Anything the team should know">' + esc(l.note) + '</textarea></label></div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button class="btn pri" id="pl-d-save" type="button">Save</button><span id="pl-d-msg" style="color:#5d7280;font-size:14px"></span></div></div>';
    d.querySelector('.x').onclick = function () { d.close(); };
    bindMeetings(d);
    [].forEach.call(d.querySelectorAll('tr[data-k]'), function (tr) { tr.onclick = null; });
    $('pl-d-save').onclick = function () {
      var b = this; b.disabled = true; $('pl-d-msg').textContent = 'Saving…';
      api('POST', { action: 'lead', key: l.key, stage: $('pl-d-stage').value, type: $('pl-d-type').value, note: $('pl-d-note').value }).then(function () { return load(false); }).then(function () { $('pl-d-msg').textContent = 'Saved'; draw(); setTimeout(function () { if (d.open) openLead(key); }, 300); }).catch(function (e) { $('pl-d-msg').textContent = e.message; }).then(function () { b.disabled = false; });
    };
    if (!d.open) d.showModal();
  }

  function fail(e) { if (MAIN) { var n = document.createElement('div'); n.className = 'note'; n.textContent = e.message; MAIN.insertBefore(n, MAIN.firstChild); } }
  function draw() {
    if (!MAIN || !DATA) return;
    if (location.hash.indexOf('#pipeline') !== 0) return;
    var body = SUB === 'leads' ? leadsView() : SUB === 'meetings' ? meetingsView() : dashboard();
    MAIN.innerHTML = head() + body;
    bindFilters();
    if (SUB === 'leads') drawLeadsTable();
    bindMeetings(MAIN);
    var d = $('pl-dialog'); if (d && d.open) bindMeetings(d);
  }
  function route(parts, main) {
    MAIN = main; SUB = parts[0] === 'leads' || parts[0] === 'meetings' ? parts[0] : '';
    if (DATA) { draw(); return; }
    main.innerHTML = '<h1>Pipeline</h1><div class="empty">Loading leads and meetings…</div>';
    (LOADING || load()).then(draw).catch(function (e) { main.innerHTML = '<h1>Pipeline</h1><div class="note">' + esc(e.message) + '</div>'; });
  }
  function nav() { return '<a href="#pipeline">Pipeline</a>'; }
  window.BH_PIPELINE = { route: route, nav: nav };
})();
