// Saves what a visitor has typed into any form on the site (as they type), so unfinished
// forms appear under "Abandoned forms" in the admin entries page. Finished forms are matched
// by email or phone and drop out of that list automatically.
(function () {
  if (!window.fetch || /^\/admin/.test(location.pathname)) return;
  var state = new WeakMap();
  var SKIP = /pass|card|cvv|cvc|ssn|token|secret|companyfax|honeypot|search/i;

  function newId() {
    var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function nameOf(form, i) {
    var t = form.getAttribute('data-form') || form.id || form.getAttribute('name') || (form.querySelector('h2,h3') || {}).textContent || '';
    t = String(t).trim().replace(/\s+/g, ' ').slice(0, 60);
    return (t || 'Form') + ' (' + location.pathname + ')';
  }
  function collect(form) {
    var out = {}, n = 0;
    [].forEach.call(form.elements, function (el) {
      var key = el.name || el.id;
      if (!key || el.disabled || SKIP.test(key)) return;
      var type = (el.type || '').toLowerCase();
      if (/^(password|hidden|file|submit|button|reset|image)$/.test(type)) return;
      if (el.getAttribute('aria-hidden') === 'true' || el.tabIndex === -1) return;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) return;
      var v = String(el.value || '').trim();
      if (!v) return;
      if (type === 'checkbox' && out[key]) v = out[key] + ', ' + v;
      out[key] = v.slice(0, 1000); n++;
    });
    return n ? out : null;
  }
  function send(form, beacon) {
    var s = state.get(form); if (!s) return;
    var fields = collect(form); if (!fields) return;
    var body = JSON.stringify({ id: s.id, form: s.name, fields: fields, page: location.href, referrer: document.referrer });
    if (body === s.last) return;
    s.last = body;
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/form-draft', new Blob([body], { type: 'application/json' }));
      else fetch('/api/form-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function track(e) {
    var form = e.target && e.target.form; if (!form || form.hasAttribute('data-no-capture')) return;
    var s = state.get(form);
    if (!s) { s = { id: newId(), name: nameOf(form), t: 0, last: '' }; state.set(form, s); form.setAttribute('data-draft-id', s.id); }
    clearTimeout(s.t); s.t = setTimeout(function () { send(form); }, 1500);
  }
  document.addEventListener('input', track, true);
  document.addEventListener('change', track, true);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    [].forEach.call(document.forms, function (f) { if (state.get(f)) send(f, true); });
  });
})();
