// Admin "Follow-up emails": status, preview of both emails, who is due next, and everything sent.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function when(ts) { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  var PREVIEW_STEP = 1, DATA = null;
  function view(main) {
    main.innerHTML = '<div class="ins-head"><div><h1>Follow-up emails</h1><p class="sub">People who typed their email into a form but never sent it get one short email an hour later, and one reminder three days after that.</p></div><div class="bar" style="margin:0"><button class="btn" id="fu-run" type="button">Check now</button></div></div><div id="fu-body"><div class="empty">Loading…</div></div>';
    $('fu-run').onclick = function () { var b = this; b.disabled = true; fetch('/api/admin/followup', { method: 'POST', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function () { load(main); }).catch(function () {}).then(function () { b.disabled = false; }); };
    load(main);
  }
  function load(main) {
    fetch('/api/admin/followup', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (r.status === 401) { location.reload(); throw new Error('Signed out'); } if (!r.ok) throw new Error(j.error || 'Could not load'); return j; }); })
      .then(function (j) { DATA = j; draw(); })
      .catch(function (e) { $('fu-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function draw() {
    var j = DATA, sent = j.log.filter(function (r) { return r.status === 'sent'; }), failed = j.log.filter(function (r) { return r.status === 'failed'; });
    var state = j.live ? '<div class="note" style="background:#eaf7ef;border-color:#cfe9d8;color:#1e5a36"><b>On.</b> Emails are going out from ' + esc(j.sender.name) + ' &lt;' + esc(j.sender.email) + '&gt;.</div>'
      : '<div class="note"><b>Off (preview only).</b> Nothing is being sent yet. ' + (!j.hasKey ? 'Add the Brevo API key as <code>BREVO_API_KEY</code> in Vercel, then ' : '') + 'set <code>FOLLOWUP_ENABLED</code> to <code>1</code> in Vercel to switch it on.</div>';
    var tiles = '<div class="ins-tiles">' + [['Sent', sent.length, 'emails'], ['First emails', sent.filter(function (r) { return r.step === 1; }).length, ''], ['Reminders', sent.filter(function (r) { return r.step === 2; }).length, ''], ['Due now', j.due.filter(function (d) { return d.step; }).length, j.live ? 'go out within the hour' : 'would go out if on'], ['Unsubscribed', j.unsubscribed, ''], ['Failed', failed.length, '']].map(function (x) { return '<div class="ins-tile"><small>' + x[0] + '</small><b>' + x[1] + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
    var p = PREVIEW_STEP === 1 ? j.preview.step1 : j.preview.step2;
    var preview = '<div class="card" style="margin-bottom:14px"><h3>What they receive</h3><div class="tabs" style="padding:0 16px"><button class="tab' + (PREVIEW_STEP === 1 ? ' on' : '') + '" data-s="1" type="button">1 hour later</button><button class="tab' + (PREVIEW_STEP === 2 ? ' on' : '') + '" data-s="2" type="button">3 days later</button></div><div style="padding:0 16px 6px;color:#5d7280;font-size:14px">From: ' + esc(j.sender.name) + ' &lt;' + esc(j.sender.email) + '&gt; &nbsp;·&nbsp; Reply-to: ' + esc(j.preview.replyTo) + '<br>Subject: <b style="color:#102534">' + esc(p.subject) + '</b></div><iframe id="fu-frame" title="Email preview" style="display:block;width:100%;height:800px;border:0;border-top:1px solid #edf3f7"></iframe></div>';
    var dueRows = j.due.map(function (d) { return '<tr><td>' + esc(d.name || '') + '</td><td>' + esc(d.email) + '</td><td>' + esc(d.company) + '</td><td>' + (d.step ? '<span class="tag">' + (d.step === 1 ? 'First email' : 'Reminder') + '</span>' : '<span class="tag off">Skipped: ' + esc(d.why) + '</span>') + '</td><td>' + esc(d.page.replace(/^https?:\/\/[^/]+/, '')) + '</td></tr>'; }).join('');
    var logRows = j.log.map(function (r) { var tag = r.status === 'sent' ? '<span class="tag ok">' + (r.step === 1 ? 'First email' : 'Reminder') + ' sent</span>' : r.status === 'unsubscribed' ? '<span class="tag off">Unsubscribed</span>' : '<span class="tag warn">Failed</span>'; return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(r.name || '') + '</td><td>' + esc(r.email) + '</td><td>' + esc(r.company || '') + '</td><td>' + tag + (r.error ? '<br><small style="color:#b3261e">' + esc(r.error) + '</small>' : '') + '</td></tr>'; }).join('');
    $('fu-body').innerHTML = state + tiles + preview +
      '<div class="card tablewrap ins-table" style="margin-bottom:14px"><h3>Due next</h3><table><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Next</th><th>Page</th></tr></thead><tbody>' + (dueRows || '<tr><td colspan="5" class="empty">Nobody is due right now.</td></tr>') + '</tbody></table></div>' +
      '<div class="card tablewrap ins-table"><h3>History</h3><table><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Company</th><th>What happened</th></tr></thead><tbody>' + (logRows || '<tr><td colspan="5" class="empty">No emails sent yet.</td></tr>') + '</tbody></table></div>' +
      '<p class="ins-note">Rules: one email an hour after someone stops typing, one reminder three days later, never more. Anyone who sends a form, unsubscribes, uses a bpohive.com address, or came from the careers or real estate recruiting pages is left alone.</p>';
    var fr = $('fu-frame'); fr.srcdoc = p.html;
    [].forEach.call($('fu-body').querySelectorAll('.tabs .tab'), function (t) { t.onclick = function () { PREVIEW_STEP = +t.dataset.s; draw(); }; });
  }
  window.BH_FOLLOWUP = { view: view };
})();
