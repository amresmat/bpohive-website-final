// Admin "Agent assessments": candidates who did the mock cold call on bpohive.com/agent-assessment,
// their AI scores and recordings, your own rating (to check the AI against your judgment), and the pass mark.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function when(ts) { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  var DATA = null, FILTER = 'all', OPEN = '';
  var RATE = [['', 'Not rated'], ['strong', 'Strong'], ['ok', 'OK'], ['weak', 'Weak']];
  function api(method, body, qs) {
    return fetch('/api/admin/hiring' + (qs || ''), { method: method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401) { location.reload(); throw new Error('Signed out'); } if (!r.ok) throw new Error(j.error || 'Could not load'); return j; }); });
  }
  function view(main, sub) {
    OPEN = sub && sub[0] ? decodeURIComponent(sub[0]) : '';
    main.innerHTML = '<div class="ins-head"><div><h1>Agent assessments</h1><p class="sub">Candidates make a short practice cold call. AI listens and scores clarity, English, fluency and sales skill. Nobody is rejected automatically: rate them yourself to check the AI before trusting the pass mark.</p></div></div><div id="hr-body"><div class="empty">Loading…</div></div>';
    api('GET').then(function (j) { DATA = j; draw(); }).catch(function (e) { $('hr-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function scoreTag(n, pass) {
    if (typeof n !== 'number') return '<span class="tag off">Not scored</span>';
    var cls = n >= pass ? 'hr-good' : n >= pass - 10 ? 'hr-mid' : 'hr-bad';
    return '<span class="hr-score ' + cls + '">' + n + '</span>';
  }
  function draw() {
    if (OPEN) return detail(OPEN);
    var j = DATA, pass = j.cfg.pass, all = j.candidates, done = all.filter(function (c) { return c.status === 'done'; });
    var scored = done.filter(function (c) { return c.scores; });
    var passed = scored.filter(function (c) { return c.scores.overall >= pass; });
    var avg = function (list) { return list.length ? Math.round(list.reduce(function (s, c) { return s + c.scores.overall; }, 0) / list.length) : null; };
    var list = all.filter(function (c) { return FILTER === 'all' ? true : FILTER === 'team' ? c.team : FILTER === 'pass' ? c.scores && c.scores.overall >= pass : FILTER === 'below' ? c.scores && c.scores.overall < pass : FILTER === 'open' ? c.status !== 'done' : true; });
    var link = location.origin + '/agent-assessment';
    var tiles = '<div class="ins-tiles">' +
      '<div class="ins-tile"><small>Completed</small><b>' + done.length + '</b><span>' + (all.length - done.length) + ' started, not finished</span></div>' +
      '<div class="ins-tile"><small>Average score</small><b>' + (avg(scored) == null ? '–' : avg(scored)) + '</b><span>out of 100</span></div>' +
      '<div class="ins-tile"><small>At or above ' + pass + '</small><b>' + passed.length + '</b><span>' + (scored.length ? Math.round(passed.length * 100 / scored.length) + '% of scored' : '') + '</span></div>' +
      '</div>';
    // Your rating vs the AI score: does the AI agree with you?
    var groups = [['strong', 'Strong'], ['ok', 'OK'], ['weak', 'Weak']].map(function (g) { var l = scored.filter(function (c) { return c.rating === g[0]; }); return '<div><b>' + g[1] + '</b><span>' + (l.length ? 'AI average ' + avg(l) + ' (' + l.length + ')' : 'none rated yet') + '</span></div>'; }).join('');
    var calib = '<div class="card hr-calib"><h3>Does the AI agree with you?</h3><p class="ins-note" style="margin:0 16px 10px">Have your current agents take it (use the team link), rate each one yourself, and compare. Set the pass mark between your "OK" and "Weak" averages.</p><div class="hr-groups">' + groups + '</div>' +
      '<div class="hr-cfg"><label>Pass mark <input type="number" min="0" max="100" id="hr-pass" value="' + pass + '"></label><button class="btn" type="button" id="hr-save">Save</button><span class="ins-note" id="hr-msg" style="margin:0"></span></div></div>';
    var links = '<div class="card hr-links"><h3>Links</h3><div class="hr-link"><span>Candidates</span><input type="text" readonly value="' + esc(link) + '"><button class="btn" type="button" data-copy="' + esc(link) + '">Copy</button></div>' +
      '<div class="hr-link"><span>Your team (marked as team)</span><input type="text" readonly value="' + esc(link + '?team=1') + '"><button class="btn" type="button" data-copy="' + esc(link + '?team=1') + '">Copy</button></div></div>';
    var tabs = [['all', 'All'], ['team', 'Team'], ['pass', 'At or above pass mark'], ['below', 'Below'], ['open', 'Not finished']].map(function (t) { return '<button type="button" class="tab' + (FILTER === t[0] ? ' on' : '') + '" data-f="' + t[0] + '">' + t[1] + '</button>'; }).join('');
    var rows = list.map(function (c) {
      var s = c.scores || {};
      return '<tr class="hr-row" data-id="' + esc(c.id) + '"><td>' + when(c.at) + '</td><td><b>' + esc(c.name) + '</b>' + (c.team ? ' <span class="tag">Team</span>' : '') + '<br><small>' + esc([c.country, c.experience].filter(Boolean).join(' · ')) + '</small></td>' +
        '<td>' + (c.status === 'done' ? scoreTag(s.overall, pass) + (c.partial ? ' <span class="tag off" title="Some answers could not be scored. Listen to them.">Partly scored</span>' : '') : '<span class="tag off">' + (c.turns || []).length + ' of 4 answers</span>') + '</td>' +
        ['clarity', 'english', 'fluency', 'sales'].map(function (k) { return '<td class="hr-n">' + (typeof s[k] === 'number' ? s[k] : '–') + '</td>'; }).join('') +
        '<td>' + (c.rating ? '<span class="tag' + (c.rating === 'weak' ? ' off' : '') + '">' + ({ strong: 'Strong', ok: 'OK', weak: 'Weak' })[c.rating] + '</span>' : '<span class="ins-note" style="margin:0">–</span>') + '</td></tr>';
    }).join('');
    $('hr-body').innerHTML = tiles + '<div class="hr-two">' + calib + links + '</div>' +
      '<div class="card tablewrap ins-table"><div class="tabs" style="padding:8px 12px 0">' + tabs + '</div><table><thead><tr><th>When</th><th>Candidate</th><th>Score</th><th>Clarity</th><th>English</th><th>Fluency</th><th>Sales</th><th>Your rating</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="empty">Nobody yet. Share the link with your team first.</td></tr>') + '</tbody></table></div>' +
      '<p class="ins-note">Score = clarity 35% + sales 30% + English 20% + fluency 15%. Clarity means how easy they are to understand on a US or Gulf call; an accent alone does not lower it. Recordings are kept for 120 days.</p>';
    [].forEach.call(document.querySelectorAll('[data-f]'), function (b) { b.onclick = function () { FILTER = this.dataset.f; draw(); }; });
    [].forEach.call(document.querySelectorAll('.hr-row'), function (r) { r.onclick = function () { location.hash = '#hiring/' + encodeURIComponent(this.dataset.id); }; });
    [].forEach.call(document.querySelectorAll('[data-copy]'), function (b) { b.onclick = function () { try { navigator.clipboard.writeText(this.dataset.copy); } catch (e) {} this.textContent = 'Copied'; }; });
    $('hr-save').onclick = function () { var b = this; b.disabled = true; api('POST', { action: 'cfg', pass: $('hr-pass').value }).then(function (r) { DATA.cfg = r.cfg; draw(); }).catch(function (e) { $('hr-msg').textContent = e.message; b.disabled = false; }); };
  }
  function detail(id) {
    var c = DATA.candidates.find(function (x) { return x.id === id; });
    if (!c) { $('hr-body').innerHTML = '<div class="empty">Candidate not found. <a href="#hiring">Back</a></div>'; return; }
    var pass = DATA.cfg.pass, s = c.scores || {};
    var turns = DATA.scenario.turns.map(function (t, i) {
      var a = (c.turns || []).find(function (x) { return x.t === i; });
      if (!a) return '<div class="hr-turn"><div class="hr-q"><b>Mike:</b> ' + esc(t.say) + '</div><p class="ins-note">No answer.</p></div>';
      var nums = a.error ? '<p class="hr-warn">Not scored: ' + esc(a.error) + '</p>' : '<div class="hr-nums">' + [['Clarity', a.clarity], ['English', a.english], ['Fluency', a.fluency], ['Sales', a.sales]].map(function (x) { return '<span>' + x[0] + ' <b>' + x[1] + '</b></span>'; }).join('') + '</div>';
      return '<div class="hr-turn"><div class="hr-q"><b>Mike:</b> ' + esc(t.say) + '</div><audio controls preload="none" src="/api/admin/hiring?audio=' + encodeURIComponent(c.id) + '&turn=' + i + '"></audio>' + nums +
        (a.transcript ? '<p class="hr-tr">“' + esc(a.transcript) + '”</p>' : '') + (a.note ? '<p class="ins-note" style="margin:4px 0 0">' + esc(a.note) + '</p>' : '') + '</div>';
    }).join('');
    $('hr-body').innerHTML = '<p><a href="#hiring">&larr; All candidates</a></p>' +
      '<div class="card hr-person"><div class="hr-top"><div><h2>' + esc(c.name) + (c.team ? ' <span class="tag">Team</span>' : '') + '</h2><p class="ins-note" style="margin:2px 0 0">' + esc([c.email, c.phone, c.country, c.experience].filter(Boolean).join(' · ')) + '</p><p class="ins-note" style="margin:2px 0 0">' + when(c.at) + (c.source ? ' · from ' + esc(c.source) : '') + '</p></div>' +
      '<div class="hr-big">' + scoreTag(s.overall, pass) + '<small>' + (typeof s.overall === 'number' ? (s.overall >= pass ? 'At or above the pass mark' : 'Below the pass mark (' + pass + ')') : c.status === 'done' ? 'Not scored' : 'Did not finish') + '</small></div></div>' +
      (typeof s.overall === 'number' ? '<div class="hr-nums hr-sum">' + [['Clarity', s.clarity], ['Sales', s.sales], ['English', s.english], ['Fluency', s.fluency]].map(function (x) { return '<span>' + x[0] + ' <b>' + x[1] + '</b></span>'; }).join('') + '</div>' : '') +
      '<div class="hr-rate"><label>Your rating <select id="hr-rating">' + RATE.map(function (r) { return '<option value="' + r[0] + '"' + ((c.rating || '') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="hr-teamck"><input type="checkbox" id="hr-team"' + (c.team ? ' checked' : '') + '> Team member (for testing)</label>' +
      '<label class="hr-note">Note<input type="text" id="hr-note" value="' + esc(c.note || '') + '" placeholder="e.g. Great energy, needs work on objections"></label>' +
      '<button class="btn" type="button" id="hr-upd">Save</button><span class="ins-note" id="hr-umsg" style="margin:0"></span></div></div>' +
      '<div class="card" style="padding:4px 16px 16px"><h3 style="padding-left:0">The call</h3>' + turns + '</div>' +
      '<p><button class="btn" type="button" id="hr-del" style="color:#B5523F">Delete candidate</button></p>';
    $('hr-upd').onclick = function () {
      var b = this; b.disabled = true;
      api('POST', { action: 'update', id: c.id, rating: $('hr-rating').value, team: $('hr-team').checked, note: $('hr-note').value }).then(function (r) { Object.assign(c, r.candidate); $('hr-umsg').textContent = 'Saved'; }).catch(function (e) { $('hr-umsg').textContent = e.message; }).then(function () { b.disabled = false; });
    };
    $('hr-del').onclick = function () {
      if (!confirm('Delete ' + c.name + ' and their recordings? This cannot be undone.')) return;
      api('POST', { action: 'delete', id: c.id }).then(function () { DATA.candidates = DATA.candidates.filter(function (x) { return x.id !== c.id; }); location.hash = '#hiring'; });
    };
  }
  window.BH_HIRING = {
    nav: function () { return '<h4>Hiring</h4><a href="#hiring">Agent assessments</a>'; },
    route: function (sub, main) { if (DATA && sub && sub[0]) { OPEN = decodeURIComponent(sub[0]); main.innerHTML = '<div class="ins-head"><div><h1>Agent assessments</h1></div></div><div id="hr-body"></div>'; return draw(); } view(main, sub); }
  };
})();
