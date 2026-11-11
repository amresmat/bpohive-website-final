// BPO Hive Insight: first-party visitor analytics for the admin "Analytics" section.
// Records what visitors see and do (page views, scrolling, clicks, the lead pop-up) and sends
// it to this website's own server. Everything a visitor types is masked before it leaves the
// browser; only "which field was touched" is kept. Once a day the browser asks ipapi.is which
// company owns its internet address, so the admin can see which companies visit.
(function () {
  'use strict';
  if (!window.fetch || !window.localStorage || /^\/admin/.test(location.pathname)) return;
  if (navigator.webdriver && !window.__bhInsightTest) return;
  if (/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom/i.test(navigator.userAgent)) return;
  try { if (Date.now() - Number(localStorage.getItem('bh_skip') || 0) < 7 * 86400000) return; } catch (e) {}

  var ENDPOINT = '/api/insight/collect';
  var IDLE_MS = 30 * 60 * 1000;      // a new session after 30 minutes of inactivity
  var FLUSH_MS = 4000;               // send buffered events this often
  var SOFT_BYTES = 48 * 1024;        // send early when the buffer grows past this
  var BEACON_BYTES = 60 * 1024;      // sendBeacon payload limit (browsers cap at 64 KB)
  var MAX_SESSION_EVENTS = 20000;    // stop recording very long sessions

  function hex(n) { var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var now = Date.now();
  var vid = store('bh_vid'); if (!/^[a-f0-9]{16}$/.test(vid || '')) { vid = hex(8); store('bh_vid', vid); }
  var s = {}; try { s = JSON.parse(store('bh_sid') || '{}'); } catch (e) { s = {}; }
  var isNew = !(/^[a-f0-9]{16}$/.test(s.id || '') && now - (s.t || 0) < IDLE_MS);
  var sid = isNew ? hex(8) : s.id;
  var seq = isNew ? 0 : (s.n || 0);
  function touch() { store('bh_sid', JSON.stringify({ id: sid, t: Date.now(), n: seq })); }
  touch();

  var buffer = [], bufBytes = 0, sent = 0, stopped = false, timer = null, sending = false, queue = [];

  function custom(tag, payload) { push({ type: 5, data: { tag: tag, payload: payload || {} }, timestamp: Date.now() }); }
  function push(ev) {
    if (stopped) return;
    var str = JSON.stringify(ev);
    buffer.push(str); bufBytes += str.length; sent++;
    if (sent > MAX_SESSION_EVENTS) { stop(); return; }
    if (bufBytes > SOFT_BYTES) flush(false);
  }
  function stop() { stopped = true; try { if (stopRecord) stopRecord(); } catch (e) {} }

  function packets(limit) {
    // Split the buffer into JSON bodies no larger than `limit` bytes each.
    var out = [], cur = [], size = 0;
    for (var i = 0; i < buffer.length; i++) {
      var e = buffer[i];
      if (e.length > limit) { if (cur.length) { out.push(cur); cur = []; size = 0; } out.push([e]); continue; }
      if (size + e.length > limit && cur.length) { out.push(cur); cur = []; size = 0; }
      cur.push(e); size += e.length + 1;
    }
    if (cur.length) out.push(cur);
    buffer = []; bufBytes = 0;
    return out.map(function (list) { seq++; return '{"sid":"' + sid + '","vid":"' + vid + '","seq":' + seq + ',"events":[' + list.join(',') + ']}'; });
  }
  function flush(final) {
    if (!buffer.length) return;
    touch();
    if (final) {
      packets(BEACON_BYTES).forEach(function (body) {
        var ok = false;
        try { ok = navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' })); } catch (e) {}
        if (!ok) { try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: body.length < BEACON_BYTES }); } catch (e2) {} }
      });
      return;
    }
    queue = queue.concat(packets(900 * 1024));
    drain();
  }
  function drain() {
    if (sending || !queue.length) return;
    var body = queue.shift(); sending = true;
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, credentials: 'omit' })
      .then(function (r) { if (r.status === 413 || r.status === 403 || r.headers.get('X-Insight') === 'skip') { stop(); store('bh_skip', String(Date.now())); } })
      .catch(function () {})
      .then(function () { sending = false; drain(); });
  }
  timer = setInterval(function () { flush(false); }, FLUSH_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });

  // --- Page view -----------------------------------------------------------------------
  function utm() { var o = {}, q = new URLSearchParams(location.search); ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) { var v = q.get(k); if (v) o[k] = String(v).slice(0, 120); }); return o; }
  custom('pageview', {
    url: location.href.slice(0, 500), path: location.pathname, title: document.title.slice(0, 160), ref: document.referrer.slice(0, 500),
    w: window.innerWidth, h: window.innerHeight, sw: screen.width, sh: screen.height, dpr: window.devicePixelRatio || 1,
    lang: navigator.language, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', utm: utm(), newSession: isNew, ua: navigator.userAgent.slice(0, 300)
  });

  // --- Which company the visitor's internet address belongs to (cached for 12 hours) ---------
  (function () {
    var c = null; try { c = JSON.parse(store('bh_org') || 'null'); } catch (e) { c = null; }
    function send(o) { if (store('bh_org_sid') === sid) return; store('bh_org_sid', sid); custom('org', { company: String(o.c || '').slice(0, 100), asn: String(o.a || '').slice(0, 120) }); }
    if (c && Date.now() - (c.t || 0) < 12 * 3600000) return send(c);
    if (store('bh_org_sid') === sid) return;
    var ctl = window.AbortController ? new AbortController() : null; if (ctl) setTimeout(function () { ctl.abort(); }, 5000);
    fetch('https://api.ipapi.is/', { credentials: 'omit', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      var name = j.company && typeof j.company === 'object' ? j.company.name : j.company, asn = j.asn && typeof j.asn === 'object' ? 'AS' + j.asn.asn + ' ' + (j.asn.org || '') : j.asn;
      if (!name) return;
      var o = { t: Date.now(), c: name, a: asn || '' }; store('bh_org', JSON.stringify(o)); send(o);
    }).catch(function () {});
  })();

  // --- Scroll depth per page (max %) ----------------------------------------------------
  var maxScroll = 0;
  function depth() { var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight; if (h <= 0) return 100; return Math.min(100, Math.round((window.scrollY || window.pageYOffset) / h * 100)); }
  window.addEventListener('scroll', function () { var d = depth(); if (d > maxScroll) { maxScroll = d; } }, { passive: true });
  window.addEventListener('pagehide', function () { custom('scroll_depth', { path: location.pathname, pct: Math.max(maxScroll, depth()) }); });

  // --- Errors (message only) ------------------------------------------------------------
  window.addEventListener('error', function (e) { custom('js_error', { msg: String(e.message || '').slice(0, 200), src: String(e.filename || '').slice(0, 200) }); });

  // --- Forms: which fields get touched, filled and abandoned (never the values) ----------
  var FORM_SKIP = /pass|card|cvv|cvc|ssn|token|secret|companyfax|honeypot/i;
  function formName(form) {
    if (!form) return '';
    if (form.closest('#quick-lead')) return 'Fill my calendar pop-up';
    var t = form.getAttribute('data-form') || form.id || form.getAttribute('name') || (form.querySelector('h2,h3') || {}).textContent || 'Form';
    return String(t).trim().replace(/\s+/g, ' ').slice(0, 60) + ' (' + location.pathname + ')';
  }
  var filledOnce = {};
  function fieldEvent(kind, el) {
    if (!el || !el.form) return;
    var name = el.name || el.id; if (!name || FORM_SKIP.test(name) || el.type === 'hidden' || el.type === 'submit') return;
    var form = formName(el.form), key = form + '|' + name;
    var filled = (el.type === 'checkbox' || el.type === 'radio') ? Boolean(el.form.querySelector('[name="' + name + '"]:checked')) : Boolean(String(el.value || '').trim());
    if (kind === 'filled') { if (!filled || filledOnce[key]) return; filledOnce[key] = 1; }
    custom('field', { form: form, name: name, k: kind, filled: filled });
  }
  document.addEventListener('focusin', function (e) { if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) fieldEvent('focus', e.target); });
  document.addEventListener('focusout', function (e) { if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { fieldEvent('filled', e.target); fieldEvent('blur', e.target); } });
  document.addEventListener('change', function (e) { if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) fieldEvent('filled', e.target); });
  document.addEventListener('submit', function (e) { var f = e.target; if (f && f.tagName === 'FORM' && !f.closest('#quick-lead')) custom('form_submit', { form: formName(f) }); }, true);

  // --- The lead pop-up funnel: opened, submitted (calendar shown), booked ----------------
  var popupSeen = false, calSeen = false;
  function watchDialog() {
    var dlg = document.getElementById('quick-lead'); if (!dlg || dlg.__bhWatched) return; dlg.__bhWatched = true;
    new MutationObserver(function () {
      if (dlg.open && !popupSeen) { popupSeen = true; custom('popup_open', { path: location.pathname, cta: (dlg.querySelector('.ql-h') || {}).textContent || '' }); }
      if (!dlg.open && popupSeen && !calSeen) { popupSeen = false; custom('popup_close', { path: location.pathname }); }
      if (dlg.classList.contains('cal') && !calSeen) { calSeen = true; custom('popup_submit', { path: location.pathname }); }
    }).observe(dlg, { attributes: true, attributeFilter: ['open', 'class'] });
  }
  watchDialog();
  new MutationObserver(watchDialog).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('message', function (e) {
    var d = e && e.data; if (!d || typeof d !== 'object' || typeof d.event !== 'string' || d.event.indexOf('calendly.') !== 0) return;
    if (d.event === 'calendly.event_scheduled') custom('booked', { path: location.pathname });
    else if (d.event === 'calendly.date_and_time_selected') custom('time_selected', { path: location.pathname });
  });

  // --- Session replay (rrweb), loaded after the page is ready ---------------------------
  var stopRecord = null;
  function startRecording() {
    if (stopped || !window.rrwebRecord || !window.rrwebRecord.record) return;
    try {
      stopRecord = window.rrwebRecord.record({
        emit: function (ev) { push(ev); },
        maskAllInputs: true,
        maskTextSelector: '.bh-mask',
        blockClass: 'bh-block',
        ignoreClass: 'bh-ignore',
        inlineStylesheet: true,
        collectFonts: false,
        recordCanvas: false,
        sampling: { mousemove: 60, mouseInteraction: true, scroll: 150, media: 800, input: 'last' },
        checkoutEveryNms: 4 * 60 * 1000
      });
    } catch (e) { /* recording is optional */ }
  }
  function loadRecorder() {
    if (window.rrwebRecord) return startRecording();
    var sc = document.createElement('script'); sc.src = '/assets/js/vendor/rrweb-record.min.js'; sc.async = true; sc.onload = startRecording; document.head.appendChild(sc);
  }
  if (document.readyState === 'complete') loadRecorder(); else window.addEventListener('load', function () { setTimeout(loadRecorder, 300); });
})();
