// The site's short lead form, shown as a pop-up. It opens from every call to action that points
// to the booking page (Book a call, Fill My Calendar, Build my campaign...) and from anything
// marked data-quick-lead. Without JavaScript the links still go to the booking page.
(function () {
  var TOP = [['US', 'United States'], ['CA', 'Canada'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['GB', 'United Kingdom'], ['AU', 'Australia']];
  var REST = [['AR', 'Argentina'], ['AT', 'Austria'], ['BH', 'Bahrain'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'], ['CL', 'Chile'], ['CN', 'China'], ['CO', 'Colombia'], ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EG', 'Egypt'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HK', 'Hong Kong'], ['HU', 'Hungary'], ['IN', 'India'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['JO', 'Jordan'], ['KE', 'Kenya'], ['KW', 'Kuwait'], ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MY', 'Malaysia'], ['MT', 'Malta'], ['MX', 'Mexico'], ['MA', 'Morocco'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NG', 'Nigeria'], ['NO', 'Norway'], ['OM', 'Oman'], ['PK', 'Pakistan'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SG', 'Singapore'], ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['ZA', 'South Africa'], ['KR', 'South Korea'], ['ES', 'Spain'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TW', 'Taiwan'], ['TH', 'Thailand'], ['TN', 'Tunisia'], ['TR', 'Turkey'], ['UA', 'Ukraine'], ['VN', 'Vietnam']];
  var DIAL = { US: 1, CA: 1, AE: 971, SA: 966, QA: 974, KW: 965, BH: 973, OM: 968, EG: 20, GB: 44, AR: 54, AU: 61, AT: 43, BE: 32, BR: 55, BG: 359, CL: 56, CN: 86, CO: 57, HR: 385, CY: 357, CZ: 420, DK: 45, EE: 372, FI: 358, FR: 33, DE: 49, GR: 30, HK: 852, HU: 36, IN: 91, ID: 62, IE: 353, IL: 972, IT: 39, JP: 81, JO: 962, KE: 254, LV: 371, LB: 961, LT: 370, LU: 352, MY: 60, MT: 356, MX: 52, MA: 212, NL: 31, NZ: 64, NG: 234, NO: 47, PK: 92, PE: 51, PH: 63, PL: 48, PT: 351, RO: 40, SG: 65, SK: 421, SI: 386, ZA: 27, KR: 82, ES: 34, SE: 46, CH: 41, TW: 886, TH: 66, TN: 216, TR: 90, UA: 380, VN: 84 };
  function dialOpts() {
    function o(c) { return '<option value="' + c[0] + '">' + flag(c[0]) + ' +' + DIAL[c[0]] + '</option>'; }
    return TOP.map(o).join('') + '<option disabled>──────</option>' + REST.map(o).join('');
  }
  function flag(cc) { return cc.replace(/./g, function (c) { return String.fromCodePoint(127397 + c.charCodeAt(0)); }); }
  function opts(list) { return list.map(function (c) { return '<option value="' + c[1] + '">' + flag(c[0]) + '  ' + c[1] + '</option>'; }).join(''); }

  var css = '.ql{width:min(560px,calc(100% - 28px));max-height:calc(100vh - 28px);margin:auto;padding:0;border:0;border-radius:18px;background:#fff;color:#0d1d2b;box-shadow:0 30px 80px rgba(8,21,33,.35);font-family:Inter,"Helvetica Neue",Arial,sans-serif;overflow:auto}' +
    '.ql::backdrop{background:rgba(8,21,33,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}' +
    '.ql[open]{animation:ql-in .28s cubic-bezier(.2,.8,.2,1)}@keyframes ql-in{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}' +
    '.ql-in{position:relative;padding:30px 30px 24px}.ql h2{margin:0 0 6px;padding-right:40px;font-family:"Nunito Sans","Avenir Next",Inter,sans-serif;font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.15}' +
    '.ql-sub{margin:0 0 20px;color:#5d7280;font-size:15px}.ql-x{position:absolute;right:14px;top:14px;width:36px;height:36px;border:0;border-radius:50%;background:#f1f5f8;color:#405967;font-size:20px;line-height:1;cursor:pointer}' +
    '.ql-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ql label,.ql legend{display:grid;gap:6px;color:#344d5c;font-size:13px;font-weight:700}.ql .full{grid-column:1/-1}.ql label small{color:#8aa0ae;font-weight:500}' +
    '.ql input[type=text],.ql input[type=email],.ql input[type=tel],.ql select{width:100%;height:46px;padding:0 13px;border:1px solid #d3e0e8;border-radius:10px;background:#fff;color:#0d1d2b;font:inherit;font-size:15px;font-weight:400}' +
    '.ql-phone{display:grid;grid-template-columns:110px 1fr;gap:8px}.ql input:focus,.ql select:focus{outline:2px solid rgba(15,122,196,.35);border-color:#0f7ac4}' +
    '.ql fieldset{grid-column:1/-1;margin:0;padding:0;border:0;min-width:0}.ql legend{margin-bottom:8px;padding:0}' +
    '.ql-chips{display:flex;flex-wrap:wrap;gap:8px}.ql-chips label{display:block;position:relative;margin:0}' +
    '.ql-chips input{position:absolute;opacity:0;width:1px;height:1px}' +
    '.ql-chips span{display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border:1px solid #d3e0e8;border-radius:999px;background:#f7fbfe;color:#203746;font-size:14px;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s,color .15s}' +
    '.ql-chips span:hover{border-color:#9bd5ff}.ql-chips input:checked+span{border-color:#0f7ac4;background:#0f7ac4;color:#fff}.ql-chips input:focus-visible+span{outline:2px solid rgba(15,122,196,.45);outline-offset:2px}' +
    '.ql-plans{display:grid;grid-template-columns:repeat(3,1fr)}.ql-plans span{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;height:100%;min-height:62px;padding:10px 14px;border-radius:14px;font-weight:700}.ql-plans small{margin-top:3px;color:#6b8291;font-size:12px;font-weight:500}.ql-plans input:checked+span small{color:#d6ecfb}@media(max-width:560px){.ql-plans{grid-template-columns:1fr}.ql-plans span{min-height:54px}}' +
    '.ql-go{width:100%;height:52px;margin-top:20px;border:0;border-radius:12px;background:#0f7ac4;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}.ql-go:hover{background:#0c6cae}.ql-go[disabled]{opacity:.6;cursor:wait}' +
    '.ql-note{margin:10px 0 0;color:#8aa0ae;font-size:12.5px;text-align:center}.ql-err{min-height:20px;margin:8px 0 0;color:#c0392b;font-size:14px}.ql-hp{position:absolute;left:-9999px}' +
    '.ql-done{text-align:center;padding:12px 0 4px}.ql-done p{color:#5d7280}' +
    '.ql.cal{width:min(1040px,calc(100% - 28px))}.ql-cal{position:relative;margin-top:6px;border:1px solid #e3ecf2;border-radius:10px;overflow:hidden}.ql-cal iframe{display:block;width:100%;height:700px;border:0}.ql-done.cal{text-align:left}' +
    '.ql-wait{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;background:radial-gradient(circle at 50% 38%,#eaf5fe,#fff 62%);text-align:center;transition:opacity .45s ease}.ql-wait.out{opacity:0;pointer-events:none}' +
    '.ql-orb{position:relative;width:74px;height:74px;margin-bottom:22px}.ql-orb:before,.ql-orb:after{content:"";position:absolute;inset:0;border-radius:50%}.ql-orb:before{border:3px solid #dcebf6;border-top-color:#0f7ac4;animation:ql-spin 1s linear infinite}.ql-orb:after{inset:23px;background:#0f7ac4;animation:ql-pulse 1.6s ease-in-out infinite}' +
    '.ql-wait.done .ql-orb:before{animation:none;border-color:#0f7ac4}.ql-wait.done .ql-orb:after{content:"\\2713";inset:12px;display:grid;place-items:center;color:#fff;font-size:24px;font-weight:900;animation:ql-pop .35s ease-out}@keyframes ql-pop{from{transform:scale(.4)}to{transform:none}}' +
    '@keyframes ql-spin{to{transform:rotate(360deg)}}@keyframes ql-pulse{50%{transform:scale(.72);opacity:.55}}' +
    '.ql-wait h3{margin:0;font-family:"Nunito Sans","Avenir Next",Inter,sans-serif;font-size:22px;font-weight:800;letter-spacing:-.02em;color:#0d1d2b}.ql-wait>p{margin:6px 0 22px;color:#5d7280;font-size:15px}' +
    '.ql-steps{display:grid;gap:12px;margin:0;padding:0;list-style:none;text-align:left}.ql-steps li{display:flex;align-items:center;gap:11px;color:#9fb2bf;font-size:15px;font-weight:600;opacity:.5;transform:translateY(4px);transition:opacity .35s,transform .35s,color .35s}' +
    '.ql-steps li:before{content:"";flex:none;width:22px;height:22px;border-radius:50%;border:2px solid #d3e0e8;box-sizing:border-box;transition:background .3s,border-color .3s}.ql-steps li.on,.ql-steps li.ok{opacity:1;transform:none;color:#203746}.ql-steps li.on:before{border-color:#0f7ac4;border-top-color:transparent;animation:ql-spin .8s linear infinite}' +
    '.ql-steps li.ok:before{content:"\\2713";display:grid;place-items:center;border:0;background:#0f7ac4;color:#fff;font-size:12px;font-weight:900;animation:none}' +
    '.ql-bar{width:220px;height:4px;margin-top:26px;border-radius:9px;background:#e3eef6;overflow:hidden}.ql-bar i{display:block;height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,#9bd5ff,#0f7ac4);transition:width 2.6s cubic-bezier(.3,.7,.3,1)}' +
    '@media(prefers-reduced-motion:reduce){.ql-orb:before,.ql-orb:after,.ql-steps li.on:before{animation:none}}' +
    '@media(max-width:560px){.ql-in{padding:24px 18px 20px}.ql-grid{grid-template-columns:1fr}.ql h2{font-size:23px}.ql-cal iframe{height:640px}}';

  var PLANS = [['validation', 'Validation Sprint', 'Test a new market or offer'], ['growth', 'Growth', 'Scale an audience that works'], ['enterprise', 'Enterprise', 'Large programs for big teams']];
  var BUDGETS = [['4000_6000', '$4,000–$6,000'], ['6000_10000', '$6,000–$10,000'], ['10000_plus', '$10,000+'], ['smaller_start', 'I’d like a smaller first step']];
  function chips(name, list) {
    return '<div class="ql-chips">' + list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      var d = Array.isArray(o) && o[2] ? '<small>' + o[2] + '</small>' : '';
      return '<label><input type="radio" name="' + name + '" value="' + v + '" required><span>' + t + d + '</span></label>';
    }).join('') + '</div>';
  }

  var html = '<dialog class="ql" id="quick-lead" aria-labelledby="ql-title"><div class="ql-in">' +
    '<button class="ql-x" type="button" aria-label="Close">×</button>' +
    '<form class="ql-form" data-form="Get qualified meetings" novalidate><h2 id="ql-title">Get qualified meetings on your calendar</h2><p class="ql-sub">Takes 30 seconds. You pick a call time right after.</p>' +
    '<div class="ql-grid">' +
    '<label>Your name<input type="text" name="name" autocomplete="name" required></label>' +
    '<label>Work email<input type="email" name="email" autocomplete="email" required></label>' +
    '<label>Company<input type="text" name="company" autocomplete="organization" required></label>' +
    '<label>Website<input type="text" name="website" inputmode="url" autocomplete="url" placeholder="yourcompany.com" required></label>' +
    '<label class="full">Phone number<span class="ql-phone"><select name="phoneCountry" aria-label="Country code">' + dialOpts() + '</select><input type="tel" name="phoneLocal" autocomplete="tel-national" minlength="6" required></span></label>' +
    '<fieldset><legend>Campaign size</legend>' + chips('plan', PLANS).replace('ql-chips', 'ql-chips ql-plans') + '</fieldset>' +
    '<label class="full">Who are you targeting?<input type="text" name="target" placeholder="e.g. Heads of Sales at software companies" required></label>' +
    '<fieldset><legend>Monthly budget</legend>' + chips('budget', BUDGETS) + '</fieldset>' +
    '</div><input class="ql-hp" name="companyFax" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="ql-go" type="submit">Fill My Calendar →</button><p class="ql-note">No obligation. We reply within one business day.</p><p class="ql-err" role="alert"></p></form>' +
    '<div class="ql-done" hidden><h2 class="ql-done-t">Thank you</h2><p class="ql-done-p">We received your details and will reply within one business day.</p><div class="ql-cal" hidden></div></div>' +
    '</div></dialog>';

  // A short, friendly loading screen while the calendar loads, so people stay for it.
  function showWait(box, first, company) {
    var w = box.querySelector('.ql-wait'), ifr = box.querySelector('iframe'), steps = w.querySelectorAll('li'), t0 = Date.now(), ended = false;
    var h = w.querySelector('h3'), sub = w.querySelector('p');
    h.textContent = first ? 'Sit tight, ' + first + '. Your calendar’s about to get busier 📅' : 'Sit tight. Your calendar’s about to get busier 📅';
    steps[1].textContent = company ? 'Briefing our team on ' + company : 'Briefing our team';
    requestAnimationFrame(function () { requestAnimationFrame(function () { w.querySelector('.ql-bar i').style.width = '88%'; }); });
    [0, 850, 1700].forEach(function (ms, i) {
      setTimeout(function () { if (i) steps[i - 1].className = 'ok'; if (!ended) steps[i].className = 'on'; }, ms);
    });
    function finish() {
      if (ended) return; ended = true;
      setTimeout(function () {
        [].forEach.call(steps, function (li) { li.className = 'ok'; });
        w.classList.add('done');
        h.textContent = 'You’re in. Pick a time that suits you.'; sub.textContent = 'Here comes the calendar.';
        w.querySelector('.ql-bar i').style.width = '100%';
        setTimeout(function () { w.classList.add('out'); setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 500); }, 900);
      }, Math.max(0, 2700 - (Date.now() - t0)));
    }
    ifr.addEventListener('load', finish); setTimeout(finish, 9000);
  }

  function init() {
    if (typeof HTMLDialogElement === 'undefined' || /^\/outbound-assessment/.test(location.pathname)) return;
    var isCta = function (el) { if (el.hasAttribute('data-quick-lead')) return true; var h = el.getAttribute('href') || ''; try { var u = new URL(h, location.href); return /(^|\.)bpohive\.com$|vercel\.app$|^localhost$/.test(u.hostname) && /^\/outbound-assessment(\.html)?\/?$/.test(u.pathname); } catch (e) { return false; } };
    var triggers = [].filter.call(document.querySelectorAll('a[href],[data-quick-lead]'), isCta);
    if (!triggers.length) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', html);
    var dlg = document.getElementById('quick-lead'), form = dlg.querySelector('form'), err = dlg.querySelector('.ql-err'),
        go = dlg.querySelector('.ql-go'), done = dlg.querySelector('.ql-done'), cal = dlg.querySelector('.ql-cal'), cta = '', lead = null;
    form.phoneCountry.value = 'US';
    // When a call is booked in the embedded calendar, record it and say so.
    window.addEventListener('message', function (e) {
      if (!/(^|\.)calendly\.com$/.test((function () { try { return new URL(e.origin).hostname; } catch (x) { return ''; } })())) return;
      if (!e.data || e.data.event !== 'calendly.event_scheduled' || !lead) return;
      fetch('/api/calendly-booked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: lead.email, companyName: lead.company || lead.website, calendly: e.data.payload || {} }) }).catch(function () {});
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
        // Each click starts fresh: the form again, with their earlier answers still filled in.
        if (form.hidden) {
          form.hidden = false; done.hidden = true; dlg.classList.remove('cal'); done.classList.remove('cal');
          cal.innerHTML = ''; cal.hidden = true;
          dlg.querySelector('.ql-done-t').textContent = 'Thank you';
          dlg.querySelector('.ql-done-p').textContent = 'We received your details and will reply within one business day.';
        }
        dlg.showModal(); var f = form.querySelector('input[name=name]'); if (f) f.focus();
      });
    });
    dlg.querySelector('.ql-x').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (!form.checkValidity()) { var bad = form.querySelector(':invalid'); err.textContent = bad && bad.type === 'radio' ? 'Please choose an option for each question.' : 'Please fill in every field, including your phone number.'; if (bad) bad.focus(); return; }
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
      var site = String(data.website || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(site)) { err.textContent = 'Please enter your company website, like yourcompany.com.'; form.querySelector('input[name=website]').focus(); return; }
      var local = String(data.phoneLocal || '').replace(/^\+?0*/, '').trim(); data.phone = local ? '+' + DIAL[data.phoneCountry] + ' ' + local : ''; delete data.phoneLocal; delete data.phoneCountry;
      data.firstName = String(data.name || '').trim().split(/\s+/)[0] || '';
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
            var u = x.j.bookingUrl + (x.j.bookingUrl.indexOf('?') > -1 ? '&' : '?') + 'embed_domain=' + encodeURIComponent(location.hostname) + '&embed_type=Inline&hide_gdpr_banner=1&hide_event_type_details=1&primary_color=0f7ac4&text_color=0d1d2b&background_color=ffffff';
            dlg.classList.add('cal'); done.classList.add('cal');
            dlg.querySelector('.ql-done-t').textContent = 'Book your discovery call';
            dlg.querySelector('.ql-done-p').textContent = 'Thanks, ' + data.firstName + '. Choose a slot below and the invite lands straight in your inbox.';
            cal.innerHTML = '<div class="ql-wait" aria-live="polite"><div class="ql-orb"></div><h3></h3><p>Give us three seconds.</p>' +
              '<ul class="ql-steps"><li>Got your details</li><li>Briefing our team</li><li>Pulling up open slots for your discovery call</li></ul><div class="ql-bar"><i></i></div></div>' +
              '<iframe title="Book a call with BPO Hive" src="' + u.replace(/"/g, '&quot;') + '"></iframe>';
            cal.hidden = false; showWait(cal, data.firstName, data.company);
          }
          if (window.dataLayer) window.dataLayer.push({ event: 'build_my_campaign_submit', budget: data.budget });
        })
        .catch(function (e2) { err.textContent = e2.message || 'Something went wrong. Please email info@bpohive.com.'; })
        .then(function () { go.disabled = false; go.textContent = 'Fill My Calendar →'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
