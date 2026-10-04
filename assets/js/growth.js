(()=>{
 'use strict';
 const $=id=>document.getElementById(id),track=(event,data={})=>{window.dataLayer=window.dataLayer||[];window.dataLayer.push({event,...data});};
 const form=$('growth-form');let started=false,latest=null;
 const market=()=>form?.elements.targetMarket?.value||form?.elements.region?.value||'unknown';
 if(form){form.addEventListener('focusin',()=>{if(!started){started=true;track('lead_form_start',{funnel_path:form.dataset.kind,target_market:market()});}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!form.reportValidity())return;
  const b=Object.fromEntries(new FormData(form));b.type=form.dataset.kind;b.marketingConsent=form.elements.marketingConsent?.checked===true;
  if(b.website){try{const u=new URL(/^https?:\/\//i.test(b.website)?b.website:'https://'+b.website);if(!['https:','http:'].includes(u.protocol)||!u.hostname.includes('.')||u.username||u.password)throw Error();b.website=u.href;}catch{$('growth-status').textContent='Enter a valid company website, such as example.com.';return;}}
  latest=b;const button=form.querySelector('[type=submit]');button.disabled=true;$('growth-status').textContent='Sending…';
  if(b.type==='strategy'){
   const qualify=['4000_6999','7000_9999','10000_plus'].includes(b.budget);
   $('quick-calendar').hidden=!qualify;$('quick-nurture').hidden=qualify;
   if(qualify){const params=new URLSearchParams({name:b.name,email:b.email,a2:b.website,a6:b.targetMarket,a9:form.querySelector('input[name=budget]:checked').dataset.label,utm_source:'bpohive.com',utm_medium:'website',utm_campaign:'strategy_call'});const url='https://calendly.com/d/43h-5tz-rkf/discovery-call?'+params;$('quick-calendar-frame').src=url+'&embed_domain='+encodeURIComponent(location.hostname)+'&embed_type=Inline';$('quick-calendar-link').href=url;track('booking_calendar_open',{funnel_path:'strategy',target_market:b.targetMarket,budget_band:b.budget});}
   else{$('quick-calendar-frame').removeAttribute('src');$('quick-calendar-link').removeAttribute('href');$('nurture-guide').href='/resources?region='+(b.targetMarket==='Canada'?'canada':b.targetMarket==='GCC'?'gcc':'usa');}
  }
  try{const response=await fetch('/api/growth-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const data=await response.json();if(!response.ok||!data.accepted)throw Error(data.error||'Please try again.');
   track('lead_form_submitted',{funnel_path:b.type,target_market:market(),budget_band:b.budget||'not_assessed',qualified:data.qualified===true});
   if(b.type==='contact')location.assign('/thank-you?type=inquiry');
   else if(b.type==='resource'){$('growth-status').textContent='Your guide is ready. Use the link below to open it or print a copy.';$('resource-result').hidden=false;$('resource-link').href=data.resourceUrl;}
   else $('growth-status').textContent=data.qualified?'Your details were received. Choose and confirm a time below to book your call.':'Your request was received and is pending individual review. We’ll email the next step if an appropriate scope is available.';
  }catch(err){$('growth-status').textContent=err.message+(b.type==='strategy'&&['4000_6999','7000_9999','10000_plus'].includes(b.budget)?' You can still choose a time in the calendar below.':'');}
  finally{button.disabled=false;}
 });}
 document.querySelectorAll('[data-path]').forEach(button=>button.addEventListener('click',()=>{
  const plan=button.dataset.path==='plan';$('quick-path').hidden=plan;$('full-assessment').hidden=!plan;
  document.querySelectorAll('[data-path]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  track('booking_path_selected',{funnel_path:plan?'assessment':'strategy'});
 }));
 if(form?.dataset.kind==='resource'){const v=new URLSearchParams(location.search).get('region');if(['usa','canada','gcc'].includes(v))form.elements.region.value=v;document.querySelectorAll('[data-region]').forEach(b=>b.addEventListener('click',()=>{form.elements.region.value=b.dataset.region;$('selected-guide').textContent=b.textContent;document.querySelectorAll('[data-region]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));if(v){const b=document.querySelector(`[data-region="${v}"]`);b?.click();}}
 window.addEventListener('message',e=>{
  const frame=$('quick-calendar-frame');if(e.origin!=='https://calendly.com'||e.source!==frame?.contentWindow||e.data?.event!=='calendly.event_scheduled'||!latest||$('quick-calendar').hidden||!['4000_6999','7000_9999','10000_plus'].includes(latest.budget))return;
  if(frame.dataset.booked)return;frame.dataset.booked='true';
  track('qualified_call_booked',{funnel_path:'strategy',target_market:latest.targetMarket,budget_band:latest.budget});
  try{sessionStorage.setItem('bpohive_booking_confirmed','1');}catch{}
  location.assign('/thank-you?type=booking');
 });
 if($('thank-you-booking')){let confirmed=false;try{confirmed=sessionStorage.getItem('bpohive_booking_confirmed')==='1';}catch{}if(new URLSearchParams(location.search).get('type')==='booking'&&confirmed){$('thank-you-booking').hidden=false;$('thank-you-inquiry').hidden=true;}}
 document.querySelectorAll('a[href^="tel:"],a[href^="https://wa.me/"]').forEach(a=>a.addEventListener('click',()=>track('contact_channel_click',{channel:a.href.startsWith('tel:')?'phone':'whatsapp'})));
 // Native dialog focus management and direct form fallback for recruitment.
 if(document.body.classList.contains('growth-careers')){
  let opener;const originalOpen=window.openApplyModal,originalClose=window.closeApplyModal;
  window.openApplyModal=id=>{opener=document.activeElement;originalOpen?.(id);document.querySelector('#'+id+' button')?.focus();};
  window.closeApplyModal=id=>{const visible=!$(id)?.classList.contains('hidden');originalClose?.(id);if(visible)opener?.focus();};
  document.addEventListener('keydown',e=>{const modal=document.querySelector('[role=dialog]:not(.hidden)');if(!modal||e.key!=='Tab')return;const targets=[...modal.querySelectorAll('button,a[href],iframe')].filter(x=>!x.disabled);const first=targets[0],last=targets[targets.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});
 }
})();
