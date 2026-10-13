// The site's short lead form, shown as a pop-up. It opens from every call to action that points
// to the booking page (Book a call, Fill My Calendar, Build my campaign...) and from anything
// marked data-quick-lead. Without JavaScript the links still go to the booking page.
(function () {
  var TOP = [['US', 'United States'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['KW', 'Kuwait'], ['BH', 'Bahrain'], ['OM', 'Oman'], ['EG', 'Egypt'], ['GB', 'United Kingdom']];
  var REST = [['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'], ['CL', 'Chile'], ['CN', 'China'], ['CO', 'Colombia'], ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HK', 'Hong Kong'], ['HU', 'Hungary'], ['IN', 'India'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['JO', 'Jordan'], ['KE', 'Kenya'], ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MY', 'Malaysia'], ['MT', 'Malta'], ['MX', 'Mexico'], ['MA', 'Morocco'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NG', 'Nigeria'], ['NO', 'Norway'], ['PK', 'Pakistan'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SG', 'Singapore'], ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['ZA', 'South Africa'], ['KR', 'South Korea'], ['ES', 'Spain'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TW', 'Taiwan'], ['TH', 'Thailand'], ['TN', 'Tunisia'], ['TR', 'Turkey'], ['UA', 'Ukraine'], ['VN', 'Vietnam']];
  var DIAL = { US: 1, CA: 1, AE: 971, SA: 966, QA: 974, KW: 965, BH: 973, OM: 968, EG: 20, GB: 44, AR: 54, AU: 61, AT: 43, BE: 32, BR: 55, BG: 359, CL: 56, CN: 86, CO: 57, HR: 385, CY: 357, CZ: 420, DK: 45, EE: 372, FI: 358, FR: 33, DE: 49, GR: 30, HK: 852, HU: 36, IN: 91, ID: 62, IE: 353, IL: 972, IT: 39, JP: 81, JO: 962, KE: 254, LV: 371, LB: 961, LT: 370, LU: 352, MY: 60, MT: 356, MX: 52, MA: 212, NL: 31, NZ: 64, NG: 234, NO: 47, PK: 92, PE: 51, PH: 63, PL: 48, PT: 351, RO: 40, SG: 65, SK: 421, SI: 386, ZA: 27, KR: 82, ES: 34, SE: 46, CH: 41, TW: 886, TH: 66, TN: 216, TR: 90, UA: 380, VN: 84 };
  // Best guess of the visitor's country from their time zone, then their browser language.
  var TZ = { 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM', 'Africa/Cairo': 'EG', 'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Bucharest': 'RO', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Singapore': 'SG', 'Asia/Hong_Kong': 'HK', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Taipei': 'TW', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Jerusalem': 'IL', 'Africa/Casablanca': 'MA', 'Africa/Tunis': 'TN', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL', 'Pacific/Auckland': 'NZ' };
  var CA_TZ = /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit)$/;
  function guessCountry() {
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (TZ[tz]) return TZ[tz];
    if (CA_TZ.test(tz)) return 'CA';
    if (/^Australia\//.test(tz)) return 'AU';
    if (/^(America|US)\//.test(tz) || /^Pacific\/Honolulu$/.test(tz)) return 'US';
    var m = String(navigator.language || '').match(/-([A-Z]{2})$/i);
    if (m && DIAL[m[1].toUpperCase()]) return m[1].toUpperCase();
    return 'US';
  }
  function dialOpts() { return TOP.concat(REST).map(function (c) { return '<option value="' + c[0] + '">' + flag(c[0]) + ' +' + DIAL[c[0]] + '</option>'; }).join(''); }
  function flag(cc) { return cc.replace(/./g, function (c) { return String.fromCodePoint(127397 + c.charCodeAt(0)); }); }
  function opts(list) { return list.map(function (c) { return '<option value="' + c[1] + '">' + flag(c[0]) + '  ' + c[1] + '</option>'; }).join(''); }

  var css = '.ql{width:min(560px,calc(100% - 28px));max-height:calc(100vh - 28px);margin:auto;padding:0;border:0;border-radius:12px;background:#fff;color:#0d1d2b;box-shadow:0 30px 80px rgba(8,21,33,.35);font-family:Inter,"Helvetica Neue",Arial,sans-serif;overflow:auto}' +
    '.ql::backdrop{background:rgba(8,21,33,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}' +
    '.ql[open]{animation:ql-in .28s cubic-bezier(.2,.8,.2,1)}@keyframes ql-in{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}' +
    '.ql-in{position:relative;padding:30px 30px 26px}.ql h2{margin:0 0 6px;font-family:"DM Sans",Inter,sans-serif;font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.15}' +
    '.ql-sub{margin:0 0 20px;color:#5d7280;font-size:15px}.ql-x{position:absolute;right:14px;top:14px;width:36px;height:36px;border:0;border-radius:50%;background:#f1f5f8;color:#405967;font-size:20px;line-height:1;cursor:pointer}' +
    '.ql-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}.ql label{display:grid;gap:5px;color:#344d5c;font-size:13px;font-weight:600}.ql .full{grid-column:1/-1}' +
    '.ql input,.ql select{width:100%;height:44px;padding:0 12px;border:1px solid #d3e0e8;border-radius:6px;background:#fff;color:#0d1d2b;font:inherit;font-size:15px;font-weight:400}' +
    '.ql-phone{display:grid;grid-template-columns:118px 1fr;gap:8px}.ql input:focus,.ql select:focus{outline:2px solid rgba(15,122,196,.35);border-color:#0f7ac4}' +
    '.ql-go{width:100%;height:50px;margin-top:18px;border:0;border-radius:6px;background:#0f7ac4;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer}.ql-go:hover{background:#0c6cae}.ql-go[disabled]{opacity:.6;cursor:wait}' +
    '.ql-err{min-height:20px;margin:10px 0 0;color:#c0392b;font-size:14px}.ql-hp{position:absolute;left:-9999px}' +
    '.ql-done{text-align:center;padding:12px 0 4px}.ql-done p{color:#5d7280}.ql-done a{display:inline-flex;align-items:center;justify-content:center;height:48px;margin-top:8px;padding:0 22px;border-radius:6px;background:#0f7ac4;color:#fff;font-weight:600;text-decoration:none}' +
    '.ql.cal{width:min(1040px,calc(100% - 28px))}.ql-cal{margin-top:6px;border:1px solid #e3ecf2;border-radius:8px;overflow:hidden}.ql-cal iframe{display:block;width:100%;height:700px;border:0}.ql-done.cal{text-align:left}' +
    '@media(max-width:560px){.ql-in{padding:24px 18px 20px}.ql-grid{grid-template-columns:1fr}.ql-cal iframe{height:640px}}';

  var html = '<dialog class="ql" id="quick-lead" aria-labelledby="ql-title"><div class="ql-in">' +
    '<button class="ql-x" type="button" aria-label="Close">×</button>' +
    '<form class="ql-form" novalidate><h2 id="ql-title">Build my campaign</h2><p class="ql-sub">Tell us a little about your company and we will get back to you within one business day.</p>' +
    '<div class="ql-grid">' +
    '<label>First name<input name="firstName" autocomplete="given-name" required></label>' +
    '<label>Last name<input name="lastName" autocomplete="family-name" required></label>' +
    '<label class="full">Business email<input name="email" type="email" autocomplete="email" required></label>' +
    '<label>Available monthly budget<select name="budget" required><option value="" disabled selected>Select</option><option value="3000_plus">$3,000+</option><option value="0_3000">$0 to $3,000</option><option value="unsure">Unsure</option></select></label>' +
    '<label>Job title<input name="jobTitle" autocomplete="organization-title" required></label>' +
    '<label>Company name<input name="company" autocomplete="organization" required></label>' +
    '<label>Company size<select name="size" required><option value="" disabled selected>Select</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201-500</option><option>501-1,000</option><option>1,000+</option></select></label>' +
    '<label>Phone number<span class="ql-phone"><select name="phoneCountry" aria-label="Country code">' + dialOpts() + '</select><input name="phoneLocal" type="tel" autocomplete="tel-national" required></span></label>' +
    '<label>Industry<input name="industry" required></label>' +
    '<label class="full">Company HQ<select name="hq" required><option value="" disabled selected>Select a country</option>' + opts(TOP) + '<option disabled>──────────</option>' + opts(REST) + '<option value="Other">🌐  Other</option></select></label>' +
    '</div><input class="ql-hp" name="companyFax" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="ql-go" type="submit">Send</button><p class="ql-err" role="alert"></p></form>' +
    '<div class="ql-done" hidden><h2 class="ql-done-t">Thank you</h2><p class="ql-done-p">We received your details and will reply within one business day.</p><div class="ql-cal" hidden></div></div>' +
    '</div></dialog>';

  function init() {
    if (typeof HTMLDialogElement === 'undefined' || /^\/outbound-assessment/.test(location.pathname)) return;
    var isCta = function (el) { if (el.hasAttribute('data-quick-lead')) return true; var h = el.getAttribute('href') || ''; try { var u = new URL(h, location.href); return /(^|\.)bpohive\.com$|vercel\.app$|^localhost$/.test(u.hostname) && /^\/outbound-assessment(\.html)?\/?$/.test(u.pathname); } catch (e) { return false; } };
    var triggers = [].filter.call(document.querySelectorAll('a[href],[data-quick-lead]'), isCta);
    if (!triggers.length) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', html);
    var dlg = document.getElementById('quick-lead'), form = dlg.querySelector('form'), err = dlg.querySelector('.ql-err'),
        go = dlg.querySelector('.ql-go'), done = dlg.querySelector('.ql-done'), cal = dlg.querySelector('.ql-cal'), cta = '', lead = null;
    var cc = guessCountry(); form.phoneCountry.value = cc;
    // When a call is booked in the embedded calendar, record it and say so.
    window.addEventListener('message', function (e) {
      if (!/(^|\.)calendly\.com$/.test((function () { try { return new URL(e.origin).hostname; } catch (x) { return ''; } })())) return;
      if (!e.data || e.data.event !== 'calendly.event_scheduled' || !lead) return;
      fetch('/api/calendly-booked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: lead.email, companyName: lead.company, calendly: e.data.payload || {} }) }).catch(function () {});
      dlg.querySelector('.ql-done-t').textContent = 'You are booked';
      dlg.querySelector('.ql-done-p').textContent = 'Your call is confirmed. Check your email for the calendar invite.';
      if (window.dataLayer) window.dataLayer.push({ event: 'calendly_booked', source: 'lead_popup' });
    });
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
      data.phone = '+' + DIAL[data.phoneCountry] + ' ' + String(data.phoneLocal || '').replace(/^\+?0*/, '').trim(); delete data.phoneLocal; delete data.phoneCountry;
      data.pageUrl = location.href; data.referrer = document.referrer; data.cta = cta;
      go.disabled = true; go.textContent = 'Sending...';
      fetch('/api/quick-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.j && x.j.error || 'Something went wrong.');
          form.hidden = true; done.hidden = false;
          lead = data;
          if (x.j.bookingUrl) {
            // Qualified leads pick a call time right here.
            var u = x.j.bookingUrl + (x.j.bookingUrl.indexOf('?') > -1 ? '&' : '?') + 'embed_domain=' + encodeURIComponent(location.hostname) + '&embed_type=Inline&hide_gdpr_banner=1';
            dlg.classList.add('cal'); done.classList.add('cal');
            dlg.querySelector('.ql-done-t').textContent = 'Pick a time for your call';
            dlg.querySelector('.ql-done-p').textContent = 'Thanks, ' + data.firstName + '. Choose a time below and the invite goes straight to your calendar.';
            cal.innerHTML = '<iframe title="Book a call with BPO Hive" src="' + u.replace(/"/g, '&quot;') + '" loading="lazy"></iframe>'; cal.hidden = false;
          }
          if (window.dataLayer) window.dataLayer.push({ event: 'build_my_campaign_submit', budget: data.budget });
        })
        .catch(function (e2) { err.textContent = e2.message || 'Something went wrong. Please email info@bpohive.com.'; })
        .then(function () { go.disabled = false; go.textContent = 'Send'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
