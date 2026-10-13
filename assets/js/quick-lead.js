// The site's short lead form, shown as a pop-up. It opens from every call to action that points
// to the booking page (Book a call, Fill My Calendar, Build my campaign...) and from anything
// marked data-quick-lead. Without JavaScript the links still go to the booking page.
(function () {
  var TOP = [['US', 'United States'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['KW', 'Kuwait'], ['BH', 'Bahrain'], ['OM', 'Oman'], ['EG', 'Egypt'], ['GB', 'United Kingdom']];
  var REST = [['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'], ['CL', 'Chile'], ['CN', 'China'], ['CO', 'Colombia'], ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HK', 'Hong Kong'], ['HU', 'Hungary'], ['IN', 'India'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['JO', 'Jordan'], ['KE', 'Kenya'], ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MY', 'Malaysia'], ['MT', 'Malta'], ['MX', 'Mexico'], ['MA', 'Morocco'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NG', 'Nigeria'], ['NO', 'Norway'], ['PK', 'Pakistan'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SG', 'Singapore'], ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['ZA', 'South Africa'], ['KR', 'South Korea'], ['ES', 'Spain'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TW', 'Taiwan'], ['TH', 'Thailand'], ['TN', 'Tunisia'], ['TR', 'Turkey'], ['UA', 'Ukraine'], ['VN', 'Vietnam']];
  function flag(cc) { return cc.replace(/./g, function (c) { return String.fromCodePoint(127397 + c.charCodeAt(0)); }); }
  function opts(list) { return list.map(function (c) { return '<option value="' + c[1] + '">' + flag(c[0]) + '  ' + c[1] + '</option>'; }).join(''); }

  var css = '.ql{width:min(560px,calc(100% - 28px));max-height:calc(100vh - 28px);margin:auto;padding:0;border:0;border-radius:12px;background:#fff;color:#0d1d2b;box-shadow:0 30px 80px rgba(8,21,33,.35);font-family:Inter,"Helvetica Neue",Arial,sans-serif;overflow:auto}' +
    '.ql::backdrop{background:rgba(8,21,33,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}' +
    '.ql[open]{animation:ql-in .28s cubic-bezier(.2,.8,.2,1)}@keyframes ql-in{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}' +
    '.ql-in{position:relative;padding:30px 30px 26px}.ql h2{margin:0 0 6px;font-family:"DM Sans",Inter,sans-serif;font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.15}' +
    '.ql-sub{margin:0 0 20px;color:#5d7280;font-size:15px}.ql-x{position:absolute;right:14px;top:14px;width:36px;height:36px;border:0;border-radius:50%;background:#f1f5f8;color:#405967;font-size:20px;line-height:1;cursor:pointer}' +
    '.ql-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}.ql label{display:grid;gap:5px;color:#344d5c;font-size:13px;font-weight:600}.ql .full{grid-column:1/-1}' +
    '.ql input,.ql select{width:100%;height:44px;padding:0 12px;border:1px solid #d3e0e8;border-radius:6px;background:#fff;color:#0d1d2b;font:inherit;font-size:15px;font-weight:400}' +
    '.ql input:focus,.ql select:focus{outline:2px solid rgba(15,122,196,.35);border-color:#0f7ac4}' +
    '.ql-go{width:100%;height:50px;margin-top:18px;border:0;border-radius:6px;background:#0f7ac4;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer}.ql-go:hover{background:#0c6cae}.ql-go[disabled]{opacity:.6;cursor:wait}' +
    '.ql-err{min-height:20px;margin:10px 0 0;color:#c0392b;font-size:14px}.ql-hp{position:absolute;left:-9999px}' +
    '.ql-done{text-align:center;padding:12px 0 4px}.ql-done p{color:#5d7280}.ql-done a{display:inline-flex;align-items:center;justify-content:center;height:48px;margin-top:8px;padding:0 22px;border-radius:6px;background:#0f7ac4;color:#fff;font-weight:600;text-decoration:none}' +
    '@media(max-width:560px){.ql-in{padding:24px 18px 20px}.ql-grid{grid-template-columns:1fr}}';

  var html = '<dialog class="ql" id="quick-lead" aria-labelledby="ql-title"><div class="ql-in">' +
    '<button class="ql-x" type="button" aria-label="Close">×</button>' +
    '<form class="ql-form" novalidate><h2 id="ql-title">Build my campaign</h2><p class="ql-sub">Tell us a little about your company and we will get back to you within one business day.</p>' +
    '<div class="ql-grid">' +
    '<label>First name<input name="firstName" autocomplete="given-name" required></label>' +
    '<label>Last name<input name="lastName" autocomplete="family-name" required></label>' +
    '<label class="full">Business email<input name="email" type="email" autocomplete="email" required></label>' +
    '<label>Available monthly budget<select name="budget" required><option value="" disabled selected>Select</option><option value="5000_plus">$5,000+</option><option value="0_5000">$0 to $5,000</option><option value="unsure">Unsure</option></select></label>' +
    '<label>Job title<input name="jobTitle" autocomplete="organization-title" required></label>' +
    '<label>Company name<input name="company" autocomplete="organization" required></label>' +
    '<label>Company size<select name="size" required><option value="" disabled selected>Select</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201-500</option><option>501-1,000</option><option>1,000+</option></select></label>' +
    '<label>Phone number<input name="phone" type="tel" autocomplete="tel" required></label>' +
    '<label>Industry<input name="industry" required></label>' +
    '<label class="full">Company HQ<select name="hq" required><option value="" disabled selected>Select a country</option>' + opts(TOP) + '<option disabled>──────────</option>' + opts(REST) + '<option value="Other">🌐  Other</option></select></label>' +
    '</div><input class="ql-hp" name="companyFax" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="ql-go" type="submit">Send</button><p class="ql-err" role="alert"></p></form>' +
    '<div class="ql-done" hidden><h2>Thank you</h2><p>We received your details and will reply within one business day.</p><a class="ql-book" hidden target="_blank" rel="noopener">Choose a call time now</a></div>' +
    '</div></dialog>';

  function init() {
    if (typeof HTMLDialogElement === 'undefined' || /^\/outbound-assessment/.test(location.pathname)) return;
    var isCta = function (el) { if (el.hasAttribute('data-quick-lead')) return true; var h = el.getAttribute('href') || ''; try { var u = new URL(h, location.href); return /(^|\.)bpohive\.com$|vercel\.app$|^localhost$/.test(u.hostname) && /^\/outbound-assessment(\.html)?\/?$/.test(u.pathname); } catch (e) { return false; } };
    var triggers = [].filter.call(document.querySelectorAll('a[href],[data-quick-lead]'), isCta);
    if (!triggers.length) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', html);
    var dlg = document.getElementById('quick-lead'), form = dlg.querySelector('form'), err = dlg.querySelector('.ql-err'),
        go = dlg.querySelector('.ql-go'), done = dlg.querySelector('.ql-done'), book = dlg.querySelector('.ql-book'), cta = '';
    [].forEach.call(triggers, function (t) {
      t.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        var label = (t.textContent || '').replace(/[→›]/g, '').replace(/\s+/g, ' ').trim();
        cta = label.slice(0, 60);
        dlg.querySelector('#ql-title').textContent = label && label.length <= 30 ? label : 'Build my campaign';
        if (!form.hidden) { dlg.showModal(); var f = form.querySelector('input'); if (f) f.focus(); } else dlg.showModal();
      });
    });
    dlg.querySelector('.ql-x').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (!form.checkValidity()) { err.textContent = 'Please complete all fields with a valid business email.'; var bad = form.querySelector(':invalid'); if (bad) bad.focus(); return; }
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.pageUrl = location.href; data.referrer = document.referrer; data.cta = cta;
      go.disabled = true; go.textContent = 'Sending...';
      fetch('/api/quick-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.j && x.j.error || 'Something went wrong.');
          form.hidden = true; done.hidden = false;
          if (x.j.bookingUrl) { book.href = x.j.bookingUrl; book.hidden = false; }
          if (window.dataLayer) window.dataLayer.push({ event: 'build_my_campaign_submit', budget: data.budget });
        })
        .catch(function (e2) { err.textContent = e2.message || 'Something went wrong. Please email info@bpohive.com.'; })
        .then(function () { go.disabled = false; go.textContent = 'Send'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
