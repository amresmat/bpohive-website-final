// Admin "Pipeline". The flow is simple:
//   a lead is booked (on a date, for a date) -> when the date comes it is a Show or a No-show ->
//   a show goes to "Shown" (the hot leads) and stays there while the team follows up through the trail ->
//   it goes to "Dead" when unqualified or not replying after many attempts (or "Won" when they sign).
// Every lead is Inbound (came through the website) or Outbound. Callers see only their own leads, read-only.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var DATA = null, MAIN = null, SUB = '', VIEW = '', LOADING = null;
  var F = { range: 30, type: '', campaign: '', caller: '', stage: '', q: '', mtab: '' };
  var STATUS = { booked: ['Booked', 'st-booked'], to_mark: ['Date passed', 'st-needs'], shown: ['Shown', 'st-showed'], no_show: ['No-show', 'st-noshow'], dead: ['Not replying or unqualified', 'st-off'], won: ['Won', 'st-won'], cancelled: ['Cancelled', 'st-off'], new: ['No meeting yet', 'st-new'] };
  var OUT = { upcoming: ['Booked', 'st-booked'], needs: ['Date passed', 'st-needs'], showed: ['Show', 'st-showed'], no_show: ['No-show', 'st-noshow'], rescheduled: ['Rescheduled', 'st-off'], cancelled: ['Cancelled', 'st-off'] };
  var HOT = { must_close: ['Must close', '#c0392b'], contract: ['Waiting on contract', '#7a5af5'], nurture: ['Nurture', '#1B7381'] };
  var HOT_RANK = { must_close: 0, contract: 1, nurture: 2 };
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
  function inRange(ts) { return !F.range || t(ts) >= Date.now() - F.range * 864e5; }
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
    var line = (s.since ? 'From ' + day(s.since + 'T12:00:00') + '. ' : '') + (c.connected ? 'Calendly synced ' + ago(c.lastSync) : 'Calendly not connected') + ', ' + (sh.files.length ? 'Sheets synced ' + ago(sh.lastSync) : 'Sheets not connected') + ', ' + (s.fathom && s.fathom.connected ? 'Fathom synced ' + ago(s.fathom.lastSync) : 'Fathom not connected') + (isAdmin() ? ', Website forms live' : '');
    var cnt = function (st) { return DATA.leads.filter(function (l) { return l.status === st; }).length; };
    var needs = DATA.meetings.filter(function (m) { return m.outcome === 'needs'; }).length;
    var sub = isAdmin() ? 'Booked, then a show or a no-show. Shows stay in Shown while you follow up, until they are won, not replying or unqualified.' : 'Your leads and appointments' + (DATA.me ? ', ' + esc(DATA.me.name) : '') + '.';
    var tabs = [['', 'Dashboard', ''], ['booked', 'Booked', needs ? needs + ' to mark' : (DATA.meetings.filter(function (m) { return m.outcome === 'upcoming'; }).length || '')], ['shown', 'Shown', cnt('shown') || ''], ['noshow', 'No-shows', cnt('no_show') || ''], ['noreply', 'Not replying', DATA.leads.filter(function (l) { return deadBucket(l) === 'no_reply'; }).length || ''], ['unqualified', 'Unqualified', DATA.leads.filter(function (l) { return deadBucket(l) === 'unqualified'; }).length || ''], ['leads', 'All leads', DATA.leads.length]];
    if (isAdmin()) tabs.push(['sources', 'Sources', ''], ['team', 'Team access', (DATA.team || []).length || '']);
    return '<div class="ins-head"><div><h1>Pipeline</h1><p class="sub">' + sub + ' <span class="pl-sync">' + esc(line) + '</span></p></div><div class="bar" style="margin:0"><button class="btn" id="pl-refresh" type="button">Refresh</button></div></div>' +
      (isAdmin() ? setup() : '') +
      '<div class="tabs">' + tabs.map(function (x) { return '<a class="tab' + (SUB === x[0] || (SUB === 'view' && !x[0]) ? ' on' : '') + (x[0] === 'shown' ? ' pl-hot' : '') + '" href="#pipeline' + (x[0] ? '/' + x[0] : '') + '">' + x[1] + (x[2] !== '' ? '<b>' + esc(x[2]) + '</b>' : '') + '</a>'; }).join('') + '</div>';
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
      (withStage ? '<select id="pl-stage">' + '<option value="">Every status</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (F.stage === k ? ' selected' : '') + '>' + STATUS[k][0] + '</option>'; }).join('') + '</select>' : '') +
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
    return '<div class="card pl-funnel"><h3>Booked, show, closed <small>people booked during this period, counted once each</small></h3><div class="pl-funs">' +
      col('All', cohort, 'all') + col('Inbound', cohort.filter(function (l) { return l.type === 'inbound'; }), 'in') + col('Outbound', cohort.filter(function (l) { return l.type !== 'inbound'; }), 'out') + '</div></div>';
  }
  function dashboard() {
    var S = sets(), showed = S.showed.length, noshow = S.noshow.length, needs = S.needs.length;
    var sub = function (k, n, label) { return n ? '<a href="#pipeline/view/' + k + '">' + n + ' ' + label + '</a>' : '0 ' + label; };
    var tiles = [
      ['Booked', S.booked.length, sub('bookedIn', S.bookedIn.length, 'inbound') + ', ' + sub('bookedOut', S.bookedOut.length, 'outbound'), '#pipeline/view/booked'],
      ['Shows', showed, esc('of ' + S.held.length + ' held'), '#pipeline/view/showed'],
      ['No-shows', noshow, '', '#pipeline/view/noshow'],
      ['Show rate', showed + noshow ? pct(showed, showed + noshow) + '%' : '—', 'of marked meetings', '#pipeline/view/rate'],
      ['Date passed', needs, needs ? 'mark show or no-show' : 'all caught up', '#pipeline/booked'],
      ['Hot leads', S.hot.length, 'in Shown now', '#pipeline/shown'],
      ['Not replying', S.noreply.length, 'all time', '#pipeline/noreply'],
      ['Unqualified', S.unq.length, 'all time', '#pipeline/unqualified'],
      ['Won', S.won.length, 'all time', '#pipeline/leads']
    ];
    var upcoming = S.ms.filter(function (m) { return m.outcome === 'upcoming' && t(m.start) < Date.now() + 7 * 864e5; }).sort(function (a, b) { return t(a.start) - t(b.start); });
    var weeks = 12;
    var lc = weekly(S.ms, function (m) { return t(m.created); }, function (m) { return m.type; }, weeks);
    var mc = weekly(S.ms.filter(function (m) { return t(m.start) < Date.now(); }), function (m) { return t(m.start); }, function (m) { return m.outcome; }, weeks);
    return filters(true, false) +
      '<div class="ins-tiles">' + tiles.map(function (x) { return '<div class="ins-tile pl-tile' + (x[0] === 'Hot leads' ? ' pl-tile-hot' : '') + '"><small>' + x[0] + '</small><b>' + x[1] + '</b><span>' + x[2] + '</span>' + viewLink(x[3]) + '</div>'; }).join('') + '</div>' +
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
      return '<tr class="pl-m-' + m.outcome + '" data-k="' + esc(m.leadKey || '') + '"><td class="pl-when">' + when(m.start) + '</td><td><small><span class="pl-mlabel">Booked on </span>' + (m.created ? esc(day(m.created)) : '—') + '</small></td><td><b>' + esc(who) + '</b><br><small>' + esc([m.company, m.invitee.email].filter(Boolean).join(', ')) + '</small></td><td>' + typeTag(m.type) + (m.callers.length ? '<br><small>' + esc(m.callers.join(', ')) + '</small>' : '') + '</td><td>' + esc(m.name) + (seqTag(m) ? ' ' + seqTag(m) : '') + (m.host ? '<br><small>with ' + esc(m.host) + '</small>' : '') + (m.sheet ? '<br><small>' + esc(m.sheet.source) + (m.sheet.confirm ? ', ' + esc(m.sheet.confirm) : '') + '</small>' : '') + (m.sheet && m.sheet.recording ? '<br><a class="pl-rec" href="' + esc(m.sheet.recording) + '" target="_blank" rel="noopener">Booking call recording</a>' : '') + (m.fathom && m.fathom.url ? '<br><a class="pl-rec" href="' + esc(m.fathom.url) + '" target="_blank" rel="noopener">Fathom recording</a>' : '') + '</td><td>' + tag(OUT, m.outcome) + (m.viaFathom ? ' <small class="pl-via">from Fathom</small>' : '') + (m.viaSheet ? ' <small class="pl-via">from sheet</small>' : '') + (compact ? '' : outcomeButtons(m)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function bookedView() {
    var ms = DATA.meetings.filter(matchesMeeting), now = Date.now();
    var groups = { needs: ms.filter(function (m) { return m.outcome === 'needs'; }), upcoming: ms.filter(function (m) { return m.outcome === 'upcoming'; }).sort(function (a, b) { return t(a.start) - t(b.start); }), past: ms.filter(function (m) { return t(m.start) < now && m.outcome !== 'needs'; }) };
    if (!groups[F.mtab]) F.mtab = groups.needs.length ? 'needs' : 'upcoming';
    var rows = groups[F.mtab] || [];
    return filters(false, false).replace('<input id="pl-q" type="search" placeholder="Search name, company, email" value="' + esc(F.q) + '">', '') +
      '<div class="tabs pl-mtabs">' + [['needs', 'Date passed'], ['upcoming', 'Upcoming'], ['past', 'Already marked']].map(function (x) { return '<button type="button" class="tab' + (F.mtab === x[0] ? ' on' : '') + '" data-t="' + x[0] + '">' + x[1] + '<b>' + groups[x[0]].length + '</b></button>'; }).join('') + '</div>' +
      (F.mtab === 'needs' && rows.length && isAdmin() ? '<p class="ins-note" style="margin:-4px 0 10px">The date came. Click <b>Show</b> or <b>No-show</b>. A show goes straight to the <a href="#pipeline/shown">Shown</a> tab.</p>' : '') +
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
  function addLeadDialog() {
    var d = dlg();
    d.innerHTML = '<div class="dl"><button class="x" type="button" aria-label="Close">×</button><h2>Add a lead</h2><p class="ins-note" style="margin:4px 0 14px">For someone you met outside Calendly and the Lead Entry sheets. They go straight to Shown.</p>' +
      '<div class="pl-upd-row pl-add-f"><label>Name<input type="text" id="pl-a-name"></label><label>Company<input type="text" id="pl-a-co"></label><label>Country<input type="text" id="pl-a-country"></label><label>Phone<input type="text" id="pl-a-phone"></label><label>Email<input type="text" id="pl-a-email"></label><label>Source<select id="pl-a-type"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label></div>' +
      '<label class="pl-a-note">What they need / first update<textarea id="pl-a-note" rows="3"></textarea></label>' +
      '<div class="pl-upd-act"><button class="btn pri" id="pl-a-save" type="button">Add to Shown</button><span id="pl-a-msg" class="ins-note" style="margin:0"></span></div></div>';
    d.querySelector('.x').onclick = function () { d.close(); };
    var q = function (id) { return d.querySelector('#' + id); };
    q('pl-a-save').onclick = function () {
      var b = this; b.disabled = true; q('pl-a-msg').textContent = 'Adding…';
      api('POST', { action: 'lead-add', name: q('pl-a-name').value, company: q('pl-a-co').value, country: q('pl-a-country').value, phone: q('pl-a-phone').value, email: q('pl-a-email').value, type: q('pl-a-type').value, note: q('pl-a-note').value, by: myName() })
        .then(function (r) { SEL = r.key; d.close(); return load(false); }).then(draw).catch(function (e) { q('pl-a-msg').textContent = e.message; b.disabled = false; });
    };
    if (!d.open) d.showModal();
  }
  function lastNote(l) { return (l.trail || []).filter(function (x) { return x.kind === 'note'; }).slice(-1)[0]; }
  function shownView() {
    var q = F.q.trim().toLowerCase();
    var all = DATA.leads.filter(matchesLead).filter(function (l) { return l.status === 'shown' && (!q || [l.name, l.company, l.email].join(' ').toLowerCase().indexOf(q) > -1); })
      .sort(function (a, b) { var ra = a.hot in HOT_RANK ? HOT_RANK[a.hot] : 9, rb = b.hot in HOT_RANK ? HOT_RANK[b.hot] : 9; return ra - rb || (overdue(b.nextStep) ? 1 : 0) - (overdue(a.nextStep) ? 1 : 0) || (b.lastActivity || 0) - (a.lastActivity || 0); });
    var idle = function (l) { return l.lastActivity && Date.now() - l.lastActivity > 14 * 864e5; };
    var due = function (l) { return l.nextStep && l.nextStep.due && new Date(l.nextStep.due + 'T00:00:00') <= new Date(); };
    var rows = HOTF === 'due' ? all.filter(due) : HOTF === 'idle' ? all.filter(idle) : HOT[HOTF] ? all.filter(function (l) { return l.hot === HOTF; }) : HOTF === 'inbound' || HOTF === 'outbound' ? all.filter(function (l) { return l.type === HOTF; }) : all;
    if (!rows.some(function (l) { return l.key === SEL; })) SEL = rows[0] ? rows[0].key : '';
    var chips = [['', 'All hot leads', all.length]].concat(Object.keys(HOT).map(function (k) { return [k, HOT[k][0], all.filter(function (l) { return l.hot === k; }).length]; })).concat([['due', 'Follow-up due', all.filter(due).length], ['idle', 'No update in 14+ days', all.filter(idle).length], ['inbound', 'Inbound', all.filter(function (l) { return l.type === 'inbound'; }).length], ['outbound', 'Outbound', all.filter(function (l) { return l.type !== 'inbound'; }).length]]).filter(function (c) { return c[0] === '' || !HOT[c[0]] || c[2]; });
    return '<div class="bar"><input id="pl-q" type="search" placeholder="Search name or company" value="' + esc(F.q) + '">' + filters(false, false).replace(/^<div class="bar">|<\/div>$/g, '').replace(/<input id="pl-q"[^>]*>/, '').replace(/<select id="pl-type">[\s\S]*?<\/select>/, '') + '</div>' +
      '<div class="pl-chips">' + chips.map(function (c) { return '<button type="button" data-hf="' + c[0] + '" class="' + (HOTF === c[0] ? 'on' : '') + '">' + esc(c[1]) + ' <b>' + c[2] + '</b></button>'; }).join('') + (isAdmin() ? '<button type="button" id="pl-add" class="pl-add">+ Add a lead</button>' : '') + '</div>' +
      '<div class="pl-split"><div class="card pl-olist">' + (rows.length ? rows.map(function (l) {
        var last = lastNote(l), nx = l.nextStep;
        return '<button type="button" class="pl-orow' + (l.key === SEL ? ' on' : '') + '" data-k="' + esc(l.key) + '"><span class="pl-orow-t"><b>' + esc(l.name || l.email) + '</b><span>' + hotTag(l.hot) + ' ' + typeTag(l.type) + '</span></span><small>' + esc([l.company, l.callers[0]].filter(Boolean).join(', ')) + '</small>' +
          (nx ? '<span class="pl-c-next' + (overdue(nx) ? ' late' : '') + '">Next: ' + esc(nx.text) + (nx.due ? ', ' + esc(dueTxt(nx)) : '') + '</span>' : l.next ? '<span class="pl-c-next">Meeting ' + esc(when(l.next)) + '</span>' : '') +
          '<span class="pl-orow-n">' + (last ? esc(last.text.slice(0, 90)) + (last.text.length > 90 ? '…' : '') : '<i>No update yet</i>') + '</span><small class="pl-orow-a">' + (l.attempts ? l.attempts + ' update' + (l.attempts === 1 ? '' : 's') + ' since the show, ' : '') + (l.lastActivity ? 'last ' + esc(ago(l.lastActivity)) : '') + '</small></button>';
      }).join('') : '<div class="empty">' + (all.length ? 'Nobody matches.' : 'No hot leads yet. When a meeting happens, mark it Show under Booked and the lead lands here.') + '</div>') + '</div>' +
      '<div class="card pl-pane" id="pl-pane"></div></div>';
  }
  function bindShown() {
    var add = $('pl-add'); if (add) add.onclick = addLeadDialog;
    [].forEach.call(MAIN.querySelectorAll('[data-hf]'), function (b) { b.onclick = function () { HOTF = b.getAttribute('data-hf'); draw(); }; });
    var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; var pos = q.selectionStart; draw(); var n = $('pl-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    var pane = $('pl-pane'), narrow = window.matchMedia('(max-width: 860px)').matches;
    [].forEach.call(MAIN.querySelectorAll('.pl-orow'), function (r) {
      r.onclick = function () { SEL = r.getAttribute('data-k'); if (narrow) { openLead(SEL); return; } [].forEach.call(MAIN.querySelectorAll('.pl-orow'), function (x) { x.classList.toggle('on', x === r); }); openLead(SEL, pane); };
    });
    if (pane && SEL && !narrow) openLead(SEL, pane);
  }

  /* ---------- No-shows and Dead ---------- */
  function simpleList(kind, bucket) {
    var q = F.q.trim().toLowerCase();
    var rows = DATA.leads.filter(matchesLead).filter(function (l) { return l.status === kind && (!bucket || deadBucket(l) === bucket) && (!q || [l.name, l.company, l.email].join(' ').toLowerCase().indexOf(q) > -1); })
      .sort(function (a, b) { return kind === 'dead' ? (b.dealAt || 0) - (a.dealAt || 0) : t(b.lastMeeting && b.lastMeeting.start) - t(a.lastMeeting && a.lastMeeting.start); });
    var note = kind === 'dead' ? (bucket === 'unqualified' ? 'Not a fit (budget, need or decision-maker). If they book again they come back by themselves.' : 'Not replying after many tries. If they book again they come back by themselves.') : 'Missed their meeting. When they rebook (Calendly or the sheet) they move back to Booked by themselves. Open one to log a follow-up or mark it dead.';
    var head = kind === 'dead' ? '<th>Lead</th><th>Source</th><th>Moved here</th><th>Updates</th><th>Last update</th>' : '<th>Lead</th><th>Source</th><th>Missed</th><th>Booked on</th><th>No-shows</th><th>Last update</th>';
    return filters(false, false) + '<p class="ins-note" style="margin:-4px 0 10px"><b>' + rows.length + '</b>, ' + esc(note) + '</p>' +
      '<div class="card tablewrap pl-table" id="pl-leads">' + (rows.length ? '<table><thead><tr>' + head + '</tr></thead><tbody>' + rows.map(function (l) {
        var last = lastNote(l);
        var mid = kind === 'dead' ? '<td><small>' + esc(day(l.dealAt)) + '</small></td><td>' + (l.trail || []).filter(function (x) { return x.kind === 'note'; }).length + '</td>'
          : '<td><small>' + esc(l.lastMeeting ? when(l.lastMeeting.start) : '—') + '</small></td><td><small>' + esc(l.lastBooked ? day(l.lastBooked) : '—') + '</small></td><td>' + (l.noShows || 1) + '</td>';
        return '<tr data-k="' + esc(l.key) + '"><td><b>' + esc(l.name || l.email || '(no name)') + '</b><br><small>' + esc([l.company, l.callers[0]].filter(Boolean).join(', ')) + '</small></td><td>' + typeTag(l.type) + '</td>' + mid + '<td class="pl-latest">' + esc(last ? last.text : '') + (last ? '<br><small>' + esc(ago(last.at)) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">Nobody here.</div>') + '</div>';
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
    var OLD = { met: 'Shown', followup: 'Shown', proposal: 'Shown', negotiation: 'Shown', hold: 'Shown', lost: 'Dead', shown: 'Shown', won: 'Won', dead: 'Dead' };
    (l.trail || []).forEach(function (x) {
      if (x.kind === 'note') ev.push({ at: x.at, k: 'note', t: 'Note', body: x.text, by: x.by, id: x.id });
      else if (x.kind === 'stage') ev.push({ at: x.at, k: 'stage', t: x.to === 'auto' ? 'Brought back' : (x.to === 'dead' || x.to === 'lost') ? 'Moved to ' + (x.reason === 'unqualified' ? 'Unqualified' : 'Not replying') : 'Marked ' + (OLD[x.to] || x.to), by: x.by, c: x.to === 'dead' || x.to === 'lost' ? '#c0392b' : x.to === 'won' ? '#1e7a43' : '#0f7ac4' });
      else if (x.kind === 'next') ev.push({ at: x.at, k: 'next', t: 'Next follow-up: ' + x.text + (x.due ? ', ' + day(x.due + 'T12:00:00') : ''), by: x.by });
      else if (x.kind === 'hot') ev.push({ at: x.at, k: 'stage', t: x.hot && HOT[x.hot] ? 'Marked ' + HOT[x.hot][0] : 'Tag removed', by: x.by, c: x.hot && HOT[x.hot] ? HOT[x.hot][1] : '#8a9aa6' });
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
    var moves = closed ? '<button class="btn" type="button" data-deal="' + (l.shownAt ? 'shown' : '') + '">' + (l.shownAt ? 'Bring back to Shown' : 'Bring back') + '</button>'
      : (l.status === 'shown' ? '<button class="btn pl-b-won" type="button" data-deal="won">Won</button>' : '') + '<button class="btn pl-b-dead" type="button" data-deal="dead" data-r="no_reply">Not replying</button><button class="btn pl-b-dead" type="button" data-deal="dead" data-r="unqualified">Unqualified</button>';
    var d = pane || dlg(), q = function (id) { return d.querySelector('#' + id); };
    d.innerHTML = '<div class="dl">' + (pane ? '' : '<button class="x" type="button" aria-label="Close">×</button>') + '<h2>' + esc(l.name || l.email) + '</h2><div style="color:#5d7280">' + esc([l.title, l.company].filter(Boolean).join(', ')) + '</div>' +
      '<div class="pl-dtags">' + typeTag(l.type) + leadTag(l) + hotTag(l.hot) + (l.nextStep ? '<span class="pl-c-next' + (overdue(l.nextStep) ? ' late' : '') + '" style="margin:0">Next: ' + esc(l.nextStep.text) + (l.nextStep.due ? ', ' + esc(dueTxt(l.nextStep)) : '') + '</span>' : '') + (l.attempts ? '<small class="ins-note" style="margin:0;align-self:center">' + l.attempts + ' update' + (l.attempts === 1 ? '' : 's') + ' since the show</small>' : '') + '</div>' +
      (isAdmin() ? '<div class="pl-upd"><h3 class="pl-h" style="margin-top:0">Notes</h3><p class="ins-note" style="margin:-4px 0 8px">Each note is added to this lead\'s trail below with the date, time and your name.</p><textarea id="pl-u-note" rows="3" placeholder="Type a note… e.g. Called twice, no answer. Sent a WhatsApp."></textarea>' +
        '<div class="pl-upd-row ' + (l.status === 'shown' ? 'pl-upd-4' : 'pl-upd-3') + '">' + (l.status === 'shown' ? '<label>Where it stands<select id="pl-u-hot"><option value="">—</option>' + Object.keys(HOT).map(function (k) { return '<option value="' + k + '"' + (l.hot === k ? ' selected' : '') + '>' + esc(HOT[k][0]) + '</option>'; }).join('') + '</select></label>' : '') + '<label>Next follow-up<input type="text" id="pl-u-next" value="' + esc(nx.text || '') + '" placeholder="Call again"></label><label>On<input type="date" id="pl-u-due" value="' + esc(nx.due || '') + '"></label><label>Your name<input type="text" id="pl-u-by" value="' + esc(myName()) + '" placeholder="Amr"></label></div>' +
        '<div class="pl-upd-act"><button class="btn pri" id="pl-u-save" type="button">Add note</button>' + (l.nextStep ? '<button class="btn" id="pl-u-done" type="button">Follow-up done</button>' : '') + '<span class="pl-moves">' + moves + '</span><span id="pl-u-msg" class="ins-note" style="margin:0"></span></div></div>' : '') +
      '<h3 class="pl-h">Trail <small class="ins-note" style="font-weight:400">newest first</small></h3>' + timelineHtml(l, ev) +
      (ms.length ? '<h3 class="pl-h">Meetings</h3><div class="pl-table">' + meetingTable(ms, false) + '</div>' : '') +
      '<details class="pl-more"><summary>Contact details</summary><dl>' + row('Email', l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '') + row('Phone', esc(l.phone)) + row('Also booked as', esc((l.aliases || []).map(function (k) { var v = k.slice(2).split('|'); return v[0] + (v[1] ? ' (' + v[1] + ')' : ''); }).join(', '))) + row('Country', esc(l.country)) + row('Came in', when(l.firstAt)) + row('How', esc(l.origin)) + row('Campaign', esc(l.campaigns.join(', '))) + row('Caller', esc(l.callers.join(', '))) + '</dl>' +
      (isAdmin() ? '<div class="pl-edit" style="margin-top:14px"><label>Source<select id="pl-d-type"><option value="">Automatic</option><option value="inbound"' + (l.typeOverride === 'inbound' ? ' selected' : '') + '>Inbound</option><option value="outbound"' + (l.typeOverride === 'outbound' ? ' selected' : '') + '>Outbound</option></select></label><div style="align-self:end"><button class="btn" id="pl-d-save" type="button">Save source</button> <span id="pl-d-msg" class="ins-note"></span></div></div>' : '') + '</details></div>';
    if (!pane) d.querySelector('.x').onclick = function () { d.close(); };
    bindMeetings(d);
    [].forEach.call(d.querySelectorAll('tr[data-k]'), function (tr) { tr.onclick = null; });
    var reopen = function () { return load(false).then(function () { draw(); if (!pane && d.open) openLead(key); }); };
    var by = function () { var v = q('pl-u-by').value.trim(); setMyName(v); return v; };
    var send = function (b, extra) {
      b.disabled = true; q('pl-u-msg').textContent = 'Saving…';
      api('POST', Object.assign({ action: 'update', key: l.key, also: l.aliases || [], note: q('pl-u-note').value, by: by(), next: { text: q('pl-u-next').value, due: q('pl-u-due').value } }, q('pl-u-hot') ? { hot: q('pl-u-hot').value } : {}, extra)).then(function (r) { if (r && r.changed === 0) { q('pl-u-msg').textContent = 'Type a note first.'; b.disabled = false; q('pl-u-note').focus(); return; } return reopen(); }).catch(function (e) { q('pl-u-msg').textContent = e.message; b.disabled = false; });
    };
    if (q('pl-u-save')) q('pl-u-save').onclick = function () { send(this, {}); };
    if (q('pl-u-note')) q('pl-u-note').onkeydown = function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(q('pl-u-save'), {}); } };
    if (q('pl-u-done')) q('pl-u-done').onclick = function () { send(this, { next: { text: '', due: '' } }); };
    [].forEach.call(d.querySelectorAll('[data-deal]'), function (b) { b.onclick = function () { send(b, { deal: b.getAttribute('data-deal'), reason: b.getAttribute('data-r') || '', from: l.status }); }; });
    [].forEach.call(d.querySelectorAll('[data-del]'), function (b) {
      b.onclick = function () { if (!b.getAttribute('data-sure')) { b.setAttribute('data-sure', '1'); b.textContent = 'Click again to delete'; return; } b.disabled = true; api('POST', { action: 'note-delete', key: l.key, also: l.aliases || [], id: b.getAttribute('data-del') }).then(reopen).catch(fail); };
    });
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
      sinceCard() + eventTypesCard() +
      '<p class="ins-note">Columns are found by their names (Prospect Name, Business Name, Agent Name, Appointment Date, Appointment Time, Timezone, Prospect Email, Call Recording Link, Confirmation Status, Show Status…), so you can add or move columns. If a row has its own Timezone (EST, GST…), that wins over the time zone above.</p>';
  }
  function sinceCard() {
    var v = DATA.status.since || '';
    return '<h3 class="pl-h" style="margin-top:22px">Start date</h3><p class="sub" style="margin-top:-4px">Meetings and leads before this date are left out of the Pipeline. Leave it empty to show everything.</p>' +
      '<div class="card pl-ev" style="padding:14px 16px"><div class="pl-upd-act" style="margin:0"><label style="display:flex;gap:10px;align-items:center;font-weight:600">Count from <input type="date" id="pl-since" value="' + esc(v) + '" style="height:38px;padding:0 10px;border:1px solid #CBD4D9;border-radius:4px"></label><button type="button" class="btn pri" id="pl-since-save">Save start date</button><span id="pl-since-msg" class="ins-note" style="margin:0"></span></div></div>';
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
    var body = SUB === 'booked' ? bookedView() : SUB === 'shown' ? shownView() : SUB === 'noshow' ? simpleList('no_show') : SUB === 'noreply' ? simpleList('dead', 'no_reply') : SUB === 'unqualified' ? simpleList('dead', 'unqualified') : SUB === 'leads' ? leadsView() : SUB === 'view' ? viewPage() : SUB === 'sources' ? sourcesView() : SUB === 'team' ? teamView() : dashboard();
    MAIN.innerHTML = head() + body;
    bindFilters();
    if (SUB === 'leads') drawLeadsTable();
    if (SUB === 'shown') bindShown();
    if ((SUB === 'noshow' || SUB === 'noreply' || SUB === 'unqualified') && $('pl-leads')) { bindLeadRows($('pl-leads')); var q = $('pl-q'); if (q) q.oninput = function () { F.q = q.value; var pos = q.selectionStart; draw(); var n = $('pl-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }; }
    if (SUB === 'sources') bindSources();
    if (SUB === 'team') bindTeam(); else LAST_INVITE = null;
    bindMeetings(MAIN);
    var d = $('pl-dialog'); if (d && d.open) bindMeetings(d);
  }
  var OLD_ROUTES = { opps: 'shown', meetings: 'booked', dead: 'noreply' };
  function route(parts, main) {
    var p = OLD_ROUTES[parts[0]] || parts[0];
    MAIN = main; SUB = ['booked', 'shown', 'noshow', 'noreply', 'unqualified', 'leads', 'view', 'sources', 'team'].indexOf(p) > -1 ? p : ''; VIEW = SUB === 'view' ? (parts[1] || '') : '';
    if (MAIN) MAIN.scrollTop = 0;
    if (DATA) { draw(); return; }
    main.innerHTML = '<h1>Pipeline</h1><div class="empty">Loading leads and meetings…</div>';
    (LOADING || load()).then(draw).catch(function (e) { main.innerHTML = '<h1>Pipeline</h1><div class="note">' + esc(e.message) + '</div>'; });
  }
  function nav() { return '<a href="#pipeline">Pipeline</a>'; }
  window.BH_PIPELINE = { route: route, nav: nav };
})();
