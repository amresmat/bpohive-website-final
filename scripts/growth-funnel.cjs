const fs=require('node:fs'),path=require('node:path'),c=require('cheerio');
const {page,org,author,ld,DATE,ORIGIN}=require('./growth-site.cjs');
const policy=require('../lib/campaign-policy.cjs');
const read=(out,p)=>c.load(fs.readFileSync(path.join(out,p),'utf8'));
const write=(out,p,$)=>fs.writeFileSync(path.join(out,p),$.html());
const hp='<div class="growth-hp" aria-hidden="true"><label>Leave blank<input name="companyFax" tabindex="-1" autocomplete="off"></label></div>';
const fields='<label for="lead-name">Name</label><input id="lead-name" name="name" autocomplete="name" required maxlength="160"><label for="lead-email">Work email</label><input id="lead-email" name="email" type="email" autocomplete="email" required maxlength="200">';
const website='<label for="lead-website">Company website</label><input id="lead-website" name="website" inputmode="url" autocomplete="url" placeholder="example.com" required maxlength="300">';
const privacy='<p class="growth-caption">We use your details to respond to this request. Read our <a href="/privacy-policy">privacy policy</a>.</p>';
const footer='<div class="growth-links"><span>Serving USA, Canada &amp; GCC</span><a href="/appointment-setting-usa">USA</a><a href="/appointment-setting-canada">Canada</a><a href="/gcc">GCC</a><a href="/contact">Contact</a><a href="https://wa.me/971563755110">WhatsApp UAE: +971 56 375 5110</a><a href="tel:+15026773800">US/Canada: +1 502 677 3800</a><a href="mailto:info@bpohive.com">info@bpohive.com</a></div>';
function funnel(out){
 let $;
 // Preserve the original assessment layout; only its source budget minimum changes.
 page(out,'contact','Contact BPO Hive','Talk to BPO Hive','Tell us which buyers you want to reach in the USA, Canada or GCC. Managed outbound campaigns start at $4,000 per month.',`<div class="grid"><section class="panel"><h2>Contact the team</h2><p><a href="mailto:info@bpohive.com">info@bpohive.com</a></p><p><a href="https://wa.me/971563755110">WhatsApp: +971 56 375 5110</a></p><p><a href="tel:+15026773800">US/Canada: +1 502 677 3800</a></p><p>Looking for a job? Visit <a href="/careers">Careers</a>.</p></section><section class="panel"><h2>Send a short inquiry</h2><form id="growth-form" data-kind="contact">${fields}<label for="lead-message">How can we help?</label><textarea id="lead-message" name="message" rows="5" required maxlength="3000"></textarea>${hp}<button class="growth-button" type="submit">Send inquiry</button>${privacy}<p id="growth-status" role="status"></p></form><noscript><p>Please email or call us using the contact details above.</p></noscript></section></div>`);
 page(out,'resources','Regional Outbound Planning Guides','Build a better outbound brief','Choose a free planning guide for the USA, Canada or GCC. Each guide is a practical worksheet you can fill in with your team.',`<div class="growth-paths"><button type="button" class="growth-button secondary" data-region="usa" aria-pressed="true">US Outbound Planning Workbook</button><button type="button" class="growth-button secondary" data-region="canada" aria-pressed="false">Canada Outreach Readiness Guide</button><button type="button" class="growth-button secondary" data-region="gcc" aria-pressed="false">GCC B2B Calling Guide</button></div><div class="panel"><h2 id="selected-guide">US Outbound Planning Workbook</h2><p>Three details to access your guide. You can print it or save it as a PDF.</p><form id="growth-form" data-kind="resource"><input type="hidden" name="region" value="usa">${fields}${website}${hp}<label><input type="checkbox" name="marketingConsent">I would also like BPO Hive to email me four practical follow-up tips and an invitation to discuss a campaign. I can withdraw by replying “unsubscribe”.</label><p class="growth-caption">Optional. Your guide does not depend on marketing consent. BPO Hive · <a href="/contact">Contact details</a>.</p><button class="growth-button" type="submit">Get my guide</button>${privacy}<p id="growth-status" role="status"></p></form><p id="resource-result" hidden><a id="resource-link" class="growth-button">Open my guide</a></p></div>`);
 for(const region of ['usa','canada','gcc']){
 const label=region==='usa'?'US Outbound Planning Workbook':region==='canada'?'Canada Outreach Readiness Guide':'GCC B2B Calling Guide';
 const specific=region==='usa'?'<h2>US planning checks</h2><p>Separate Eastern, Central, Mountain and Pacific buyer schedules. Confirm exceptions, mobile-number handling, applicable TCPA/FCC and state requirements, suppression and call-recording rules. A B2B label is not a universal exemption.</p><p><a href="https://www.fcc.gov/general/telemarketing">FCC telemarketing guidance</a></p>':region==='canada'?'<h2>Canada planning checks</h2><p>List each province, language requirement and buyer-local time zone, including Newfoundland’s half-hour offset. Record the valid basis for commercial electronic messages and any applicable exemption; a public business email is not blanket permission. Separate CASL email requirements from CRTC calling rules.</p><p><a href="https://crtc.gc.ca/eng/com500/guide.htm">CRTC consent guidance</a> · <a href="https://crtc.gc.ca/eng/phone/telemarketing/biz.htm">Telemarketing guidance</a></p>':'<h2>GCC planning checks</h2><p>Create separate rows for UAE, Saudi Arabia, Qatar, Kuwait, Bahrain and Oman. UAE and Oman are UTC+4; the other four are UTC+3. Agree English/Arabic staffing, working weeks and Ramadan adjustments. Review each country’s telecom and data requirements; the UAE covered-calling window of 9 a.m.–6 p.m. is not a GCC-wide rule.</p><p><a href="https://uaelegislation.gov.ae/en/legislations/2519/download">UAE telemarketing regulation</a> · <a href="https://www.cst.gov.sa/en/regulations-and-licenses/regulations/Document-522">Saudi CST guidance</a></p>';
 page(out,'guides/'+region,label+' 2026',label+' 2026','A working brief for your next B2B campaign. Fill it in with your own numbers.',`${specific}<h2>1. Analyze the market</h2><p>Write one offer, one organization type and one business problem. List the roles that use, influence and approve a purchase. State territories you cannot serve and accounts already in your pipeline.</p><table><tr><th>Input</th><th>Your working answer</th></tr>${['Offer and buyer problem','Industry and company size','Countries, languages and hours','Buyer role and authority','Excluded accounts','Evidence that the problem matters'].map(x=>`<tr><td>${x}</td><td>________________________</td></tr>`).join('')}</table><h2>2. Craft the strategy</h2><p>Write a two-sentence reason for contact. Identify the channel and contact basis, source of the data, suppression process, approved claims and owner of specialist questions. Define the qualification standard before deciding how many people to approach.</p><ol><li>The company fits because: __________.</li><li>The relevant role is: __________.</li><li>The business need to explore is: __________.</li><li>The agreed next step is: __________.</li></ol><h2>3. Execute with a clear handoff</h2><p>Assign an outreach owner and a sales owner. Record the role, stated interest, objections, local time and next step for every accepted meeting. A positive reply is not yet a meeting; a meeting is not yet an opportunity. Stop or suppress contacts when required.</p><h2>4. Scale using evidence</h2><p>Review weekly: attempts, reached prospects, meaningful conversations, qualified interest, booked calls, held calls and accepted opportunities. Record the reasons sales rejects a handoff. Change one major input at a time so the team can interpret the result.</p><h2>Economics worksheet</h2><p>Campaign spend ÷ booked calls = cost per booked call. Campaign spend ÷ held calls = cost per held call. Campaign spend ÷ accepted opportunities = cost per opportunity. Use a dash when the denominator is zero.</p><p>Illustration only: $4,000 spend and 10 booked calls means $400 per booked call. If 7 are held, the held-call cost is about $571.</p><h2>Launch checklist</h2><ul><li>Audience and exclusions approved.</li><li>Contact approach and data handling reviewed.</li><li>Language, hours and staffing agreed.</li><li>Message and claims approved.</li><li>Qualification and sales follow-up assigned.</li><li>Reporting and weekly review scheduled.</li></ul><p>Print this page or choose Save as PDF in your browser’s print menu. Managed BPO Hive campaigns start at $4,000/month. <a href="/outbound-assessment">Discuss your brief</a>.</p>`);
 }
 page(out,'thank-you','Next Steps · BPO Hive','Your next steps','Keep your campaign objective and target audience handy so the team can prepare a useful response.',`<section id="thank-you-inquiry"><h2>Thank you for getting in touch</h2><p>If you submitted an inquiry, our team will review it and reply to your work email. A form submission does not book an appointment.</p><p>Ready to choose a time? <a href="/outbound-assessment">Book a strategy call</a>.</p></section><section id="thank-you-booking" hidden><h2>Your strategy call is booked</h2><p>Check the Calendly confirmation email for the exact date, local time and meeting link. Use its Add to calendar link to add the confirmed appointment; use the same email to reschedule or cancel.</p><p><a class="growth-button secondary" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noopener">Open my Google Calendar</a></p><p>This opens your calendar; the confirmation email contains the event-specific add link.</p><ol><li>Bring your target market and buyer profile.</li><li>Prepare a short description of your offer and sales process.</li><li>Identify who will take sales meetings and the monthly budget.</li></ol></section><p>Need help? <a href="mailto:info@bpohive.com">info@bpohive.com</a>.</p>`);
 // Make starting price explicit while retaining the existing approved program scopes.
 $=read(out,'pricing.html');$('title').text('Appointment Setting Pricing · From $4,000/Month | BPO Hive');$('h1').first().text('Managed outbound pricing from $4,000 per month');
 $('p').each((i,e)=>{if($(e).text().includes('No public package price'))$(e).text('Managed campaigns start at $4,000 per month. Growth and Enterprise programs are custom quoted around audience, market, language and delivery capacity. Your written proposal defines the exact scope and any third-party costs.');});
 $('h3').each((i,e)=>{const v=$(e).text().trim();if(v==='Validation Sprint')$(e).after('<p class="growth-price"><strong>From $4,000/month</strong></p>');if(['Growth','Enterprise'].includes(v))$(e).after('<p class="growth-price"><strong>Custom quote · above the $4,000 starting scope</strong></p>');});
 $('.herocopy').first().text('BPO Hive managed outbound starts at $4,000/month for an agreed campaign scope. USA, Canada and GCC programs combine research, outreach, qualification and reporting; higher-capacity tiers are custom quoted.').after('<p class="herocopy">'+policy.scope+' '+policy.portal+' '+policy.insights+'</p>');$('main').append('<div class="growth-links"><a href="/appointment-setting-cost">Cost and ROI guide</a><a href="/vs/in-house-sdr">Compare in-house SDRs</a><a href="/vs/belkins">Compare Belkins</a><a href="/vs/salesroads">Compare SalesRoads</a></div>');write(out,'pricing.html',$);
 // Common commercial navigation, schema and content-link rules across published HTML.
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()&&!['assets','admin'].includes(x.name)?walk(path.join(dir,x.name)):x.isFile()&&x.name.endsWith('.html')?[path.join(dir,x.name)]:[]);
 for(const file of walk(out)){
  const rel=path.relative(out,file).replaceAll('\\','/'),career=rel==='careers.html';$=c.load(fs.readFileSync(file,'utf8'));
  $('head').append('<link rel="stylesheet" href="/assets/css/growth.css"><script src="/assets/js/growth.js" defer></script>');
  if(rel!=='outbound-assessment.html'&&!career){
   $('a[href*="calendly.com"]').attr('href','/outbound-assessment').removeAttr('onclick');
   $('[onclick*="openBookingModal"],[onclick*="Calendly.initPopupWidget"]').each((i,e)=>{const a=$('<a href="/outbound-assessment"></a>').attr('class',$(e).attr('class')||'growth-button').html($(e).html());$(e).replaceWith(a);});
  }
  $('a[href]').each((i,e)=>{let v=$(e).attr('href');if(/(?:^|\/)(work-with-us|careers)(?:\.html)?(?:$|#)/.test(v)){$(e).attr('href','/careers');if(/work with us/i.test($(e).text()))$(e).text('Careers');}if(!/^(?:[a-z]+:|\/|#)/i.test(v)){try{const u=new URL(v,ORIGIN+'/'+rel);if(u.origin===ORIGIN)$(e).attr('href',u.pathname.replace(/\.html$/,'')+u.search+u.hash);}catch{}}});
  if(!career){
   const nav=$('nav').first(),existing=nav.find('a').filter((i,e)=>/outbound-assessment/.test($(e).attr('href')||''));
   const parent=nav.find('.nav-inner,.navin,.flex.items-center.justify-between').first();
   if(existing.length){existing.first().text('Book a call').addClass('growth-book');if(existing.first().parents('.hidden').length&&parent.length)parent.append('<a class="growth-book growth-mobile-book" href="/outbound-assessment">Book a call</a>');}else{(parent.length?parent:nav).append('<a class="growth-book" href="/outbound-assessment">Book a call</a>');}
   $('footer').append(footer);
  }else{
   $('body').addClass('growth-careers');$('a[href*="calendly"],a[href*="outbound-assessment"],a[href^="tel:"],a[href*="wa.me"]').remove();
   $('body').append('<a class="growth-button growth-apply" href="#open-positions">Apply · View open positions</a>');
   $('[role=dialog]').each((i,e)=>{const src=$(e).find('iframe').attr('src');if(src){const u=new URL(src);$(e).find('h3').first().after(`<a href="${u.origin+u.pathname}" target="_blank" rel="noopener" style="padding:10px;text-decoration:underline">Open application in a new tab</a>`);}});
   $('#mobile-menu-btn').attr('aria-label','Toggle navigation').attr('aria-controls','mobile-menu');
   $('.job-card').css('cursor','default');
  }
  if(career||rel==='form-received.html'||rel==='thank-you.html'||rel.startsWith('guides/')){if($('meta[name=robots]').length)$('meta[name=robots]').attr('content','noindex, follow');else $('head').append('<meta name="robots" content="noindex, follow">');}
  // Replace only general market labels; jurisdiction-specific article/legal language stays intact.
  if(!rel.startsWith('blog-')&&!/policy|terms/.test(rel)){
   $('title,meta[name=description],meta[property="og:title"],meta[property="og:description"],h1,p').each((i,e)=>{if(e.tagName==='meta'){const v=$(e).attr('content')||'';$(e).attr('content',v.replace(/USA\s*(?:&|and)\s*GCC/g,'USA, Canada & GCC'));}else if(!$(e).children().length){const v=$(e).text();if(/USA\s*(?:&|and)\s*GCC/.test(v))$(e).text(v.replace(/USA\s*(?:&|and)\s*GCC/g,'USA, Canada & GCC'));}});
  }
  if(rel.startsWith('blog-')){const target=$('article').first();target.append('<aside class="growth-links"><a href="/services/appointment-setting">Explore appointment setting</a><a href="/services/sales-development">Explore sales development</a></aside>');}
  if(rel==='index.html'){
   $('title').text('BPO Hive | B2B Lead Generation & Appointment Setting');
   $('footer').before(`<section class="bh-featured" aria-labelledby="bh-featured-title">
    <style>
     .bh-featured{max-width:1200px;margin:0 auto;padding:56px 24px 64px}
     .bh-featured h2{margin:0 0 28px;color:#102534;font-size:clamp(26px,3vw,36px);font-weight:700;line-height:1.2;letter-spacing:-.025em}
     .bh-featured-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
     .bh-featured-card{display:flex;flex-direction:column;border:1px solid #dbe8f0;border-radius:18px;overflow:hidden;background:#f3f8fc;text-decoration:none;color:#102534;transition:border-color .2s,transform .2s}
     .bh-featured-card:hover{border-color:#87caff;transform:translateY(-3px)}
     .bh-featured-card:focus-visible{outline:3px solid #87caff;outline-offset:4px}
     .bh-featured-logo{height:120px;display:flex;align-items:center;justify-content:center;background:#fff;padding:24px}
     .bh-featured-logo img{width:auto;max-width:100%;height:auto;max-height:72px;object-fit:contain}
     .bh-featured-goodfirms{font-family:Arial,sans-serif;font-size:30px;font-weight:700;color:#1674bd;letter-spacing:-1.4px}
     .bh-featured-label{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:18px;font-size:14px;line-height:1.4}
     .bh-featured-label span:last-child{color:#87caff;font-size:20px}
     @media(max-width:760px){.bh-featured{padding:38px 18px 44px}.bh-featured-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.bh-featured-logo{height:104px;padding:18px}.bh-featured-goodfirms{font-size:25px}.bh-featured-label{padding:14px;font-size:12px}}
     @media(prefers-reduced-motion:reduce){.bh-featured-card{transition:none}.bh-featured-card:hover{transform:none}}
    </style>
    <h2 id="bh-featured-title">Featured and listed</h2>
    <div class="bh-featured-grid">
     <a class="bh-featured-card" href="https://evergreenawards.com/awards/bpo-hive-best-outsourcing-appointment-setting-company-in-the-us-of-2025" target="_blank" rel="noopener" aria-label="Evergreen Award · 2025">
      <div class="bh-featured-logo"><img src="/assets/logo/trust-badges/evergreen.webp" alt="Evergreen Awards" loading="lazy"></div><div class="bh-featured-label"><span>Evergreen Award · 2025</span><span aria-hidden="true">↗</span></div>
     </a>
     <a class="bh-featured-card" href="https://themanifest.com/eg/bpo/companies" target="_blank" rel="noopener" aria-label="The Manifest · BPO listing">
      <div class="bh-featured-logo"><img src="/assets/logo/trust-badges/themanifestlogo.webp" alt="The Manifest" loading="lazy"></div><div class="bh-featured-label"><span>BPO listing</span><span aria-hidden="true">↗</span></div>
     </a>
     <a class="bh-featured-card" href="https://clutch.co/profile/bpo-hive" target="_blank" rel="noopener" aria-label="Clutch · Reviews">
      <div class="bh-featured-logo"><img src="/assets/logo/trust-badges/Clutch-Logo.png" alt="Clutch" loading="lazy"></div><div class="bh-featured-label"><span>Client reviews</span><span aria-hidden="true">↗</span></div>
     </a>
     <a class="bh-featured-card" href="https://www.goodfirms.co/bpo-services/egypt" target="_blank" rel="noopener" aria-label="GoodFirms · BPO listing">
      <div class="bh-featured-logo"><span class="bh-featured-goodfirms">GoodFirms</span></div><div class="bh-featured-label"><span>BPO listing</span><span aria-hidden="true">↗</span></div>
     </a>
    </div>
   </section>`);
  }
  if(rel==='about.html')$('h3').filter((i,e)=>$(e).text().trim()==='Amr Abdelrazzak').attr('id','amr-abdelrazzak');
  if(rel==='case-studies.html'){
   $('meta[name=description],meta[property="og:description"],meta[name="twitter:description"]').attr('content','Explore BPO Hive campaign approaches. Company-reported cumulative results: 21,200+ appointments and $25M+ client revenue. Outcomes vary.');
   $('div.text-4xl').each((i,e)=>{const t=$(e).text().trim();if(t==='$20.7M+')$(e).text('$25M+');else if(t==='20,000+')$(e).text('21,200+');else $(e).parent().remove();});
   $('div.text-3xl').parent().remove();$('span.text-lg.font-bold.text-bpo-blue').parent().remove();$('span.uppercase').filter((i,e)=>/months/.test($(e).text())).remove();
   $('p').each((i,e)=>{const t=$(e).text();if(/Estimated 11,760/.test(t))$(e).text('The campaign supported recurring appointment handoffs and weekly performance review.');if(/Sales team averaged approximately/.test(t))$(e).text('The engagement combined sales-team management with clearer reporting and operational coordination.');if(/Average output of 10 shown demos/.test(t))$(e).text('The team tracked held demos and subsequent sales outcomes as separate stages.');});
   $('h2').filter((i,e)=>$(e).text().trim()==='Combined Impact').after('<p class="growth-caption">Company-reported cumulative figures. Individual outcomes vary; these totals are not forecasts.</p>');
  }
  if(rel==='industries.html'){
   $('p').each((i,e)=>{const t=$(e).text().trim();if(t==='30%')$(e).parent().remove();if(t==='Book 30% more appointments')$(e).text('Build a qualified sales pipeline');if(t==='$25.0M+')$(e).text('$25M+');if(t==='21,200')$(e).text('21,200+');});
  }
  if(rel==='index.html')$('.reported-result').remove();
  // Remove obsolete duplicate Organization nodes; one consistent organization identity.
  $('script[type="application/ld+json"]').each((i,e)=>{try{let data=JSON.parse($(e).html());if(data['@type']==='Organization'){ $(e).remove();return;}if(data['@graph'])data['@graph']=data['@graph'].filter(x=>x['@type']!=='Organization');$(e).text(JSON.stringify(data).replace(/</g,'\\u003c'));}catch{}});
  $('head').append(ld({'@context':'https://schema.org','@graph':[org,author]}));
  // Homepage and pricing are also the two priority editorial pages not generated above.
  if(['index.html','pricing.html'].includes(rel))$('head').append(ld({'@context':'https://schema.org','@type':'WebPage',url:ORIGIN+(rel==='index.html'?'/':'/pricing'),dateModified:DATE,author:{'@id':author['@id']}}));
  fs.writeFileSync(file,$.html());
 }
 const pages=walk(out).filter(p=>!['404.html','careers.html','form-received.html','thank-you.html','services/customer-support.html'].includes(path.relative(out,p))&&!path.relative(out,p).startsWith('guides/'));
 fs.writeFileSync(path.join(out,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+pages.map(p=>{const rel=path.relative(out,p).replaceAll('\\','/').replace(/\.html$/,'');return `<url><loc>${ORIGIN}${rel==='index'?'/':'/'+rel}</loc><lastmod>${DATE}</lastmod></url>`;}).join('\n')+'\n</urlset>\n');
}
module.exports={funnel};
