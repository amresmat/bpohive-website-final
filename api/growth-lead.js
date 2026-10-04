// Uses the existing notification workflow contract; never fabricates forecast fields.
const recent=new Map();
const {budgetLabels:budgets,qualifiedBudget,scope,portal,insights,minimumCopy,exceptionCopy}=require('../lib/campaign-policy.cjs');
const markets=['USA','Canada','GCC','Multiple'];
const text=(v,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function website(v){try{const u=new URL(/^https?:\/\//i.test(v)?v:'https://'+v);return ['https:','http:'].includes(u.protocol)&&u.hostname.includes('.')&&!u.username&&!u.password?u.href:'';}catch{return '';}}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(process.env.VERCEL_ENV==='production'){
  let host;try{host=new URL(req.headers.origin).hostname;}catch{}
  if(!['www.bpohive.com','bpohive.com',process.env.VERCEL_URL].filter(Boolean).includes(host))return res.status(403).json({error:'Origin not allowed'});
 }
 const now=Date.now(),key=text(req.headers?.['x-forwarded-for'],200).split(',')[0]||req.socket?.remoteAddress||'unknown';
 for(const [k,v] of recent)if(now-v.start>600000)recent.delete(k);
 const hit=recent.get(key)||{start:now,count:0};hit.count++;recent.set(key,hit);
 if(hit.count>8)return res.status(429).json({error:'Please wait a few minutes before trying again.'});
 let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'Invalid request'});}
 if(!b||JSON.stringify(b).length>12000)return res.status(400).json({error:'Invalid request'});
 if(b.companyFax)return res.status(200).json({accepted:true});
 const type=text(b.type,30),name=text(b.name,160),email=text(b.email,200).toLowerCase(),url=website(text(b.website,300)),market=text(b.targetMarket,30),budget=text(b.budget,30),message=text(b.message,3000),region=text(b.region,20);
 if(!['strategy','contact','resource'].includes(type)||!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter your name and a valid work email.'});
 if(type!=='contact'&&!url)return res.status(400).json({error:'Enter a valid company website.'});
 if(type==='strategy'&&(!markets.includes(market)||!Object.hasOwn(budgets,budget)))return res.status(400).json({error:'Choose a target market and budget.'});
 if(type==='contact'&&!message)return res.status(400).json({error:'Please tell us how we can help.'});
 if(type==='resource'&&!['usa','canada','gcc'].includes(region))return res.status(400).json({error:'Choose a regional guide.'});
 const qualified=type==='strategy'&&qualifiedBudget(budget);
 const p=new URLSearchParams({name,email,a2:url,a6:market,a9:budgets[budget]||'',utm_source:'bpohive.com',utm_medium:'website',utm_campaign:'strategy_call'});
 const bookingUrl=qualified?'https://calendly.com/d/43h-5tz-rkf/discovery-call?'+p:'';
 const resourceUrl=type==='resource'?`https://www.bpohive.com/guides/${region}`:'';
 const owner=process.env.LEAD_NOTIFICATION_EMAIL||'info@bpohive.com';
 const subject=type==='contact'?'We received your BPO Hive inquiry':type==='resource'?'Your BPO Hive regional planning guide':qualified?'Choose your BPO Hive strategy call time':'Your BPO Hive scope-review request';
 const next=type==='resource'?`<p><a href="${resourceUrl}">Open your requested guide</a>. Use your browser’s Print option to save a PDF.</p>`:type==='contact'?'<p>Thank you for your inquiry. Our team will review your message and reply to this email address.</p>':qualified?`<p>Choose a time for your strategy call: <a href="${escape(bookingUrl)}">Open your prefilled calendar</a>. Managed campaigns start at $4,000/month. No appointment is booked until you select and confirm a time.</p>`:`<p>Your request is pending individual review.</p><p>${escape(minimumCopy)}</p><p>${escape(exceptionCopy)}</p><p>If an appropriate scope is available, we’ll email you the next step. In the meantime, use our <a href="https://www.bpohive.com/roi-calculator">ROI calculator</a> and <a href="https://www.bpohive.com/resources">regional planning guides</a>.</p>`;
 const rows={Name:name,Email:email,Website:url,Market:market,Budget:budgets[budget]||'',Message:message,Resource:region,'Marketing consent':b.marketingConsent===true?'Yes':'No'};
 const event={type:'growth_'+type+'_submitted',source:'BPO Hive '+type,submitted_at:new Date().toISOString(),first_name:name.split(' ')[0],last_name:name.split(' ').slice(1).join(' '),work_email:email,company_name:url?new URL(url).hostname:name,company_website:url,target_market:market,initial_campaign_budget:budgets[budget]||'',qualified,qualification_status:type==='strategy'?(qualified?'Qualified':'Pending individual review'):'Not assessed',message,resource_region:region,marketing_consent:b.marketingConsent===true,consent_version:'regional-followup-v1-2026-09-26',page_url:'/'.concat(type==='strategy'?'outbound-assessment':type==='contact'?'contact':'resources'),prefilled_calendly_link:bookingUrl,prospect_email_to:email,prospect_email_subject:subject,prospect_email_html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><p>Hi ${escape(name.split(' ')[0])},</p>${next}${type==='strategy'&&qualified?'<p>'+escape(scope)+'</p><p>'+escape(portal)+'</p><p>'+escape(insights)+'</p>':''}<p>BPO Hive<br><a href="mailto:${escape(owner)}">${escape(owner)}</a></p></div>`,prospect_email_reply_to:owner,owner_email_to:owner,owner_email_reply_to:email,owner_email_subject:`BPO Hive ${type}: ${name.replace(/[\r\n]/g,' ')}`,owner_email_html:'<table>'+Object.entries(rows).map(([k,v])=>`<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`).join('')+'</table>'};
 // Dedicated webhook is optional; the existing Zap reads the same email fields.
 const hook=process.env.GROWTH_WEBHOOK_URL||process.env.ZAPIER_WEBHOOK_URL;
 if(!hook)return res.status(503).json({error:'The form is temporarily unavailable. Email info@bpohive.com or call +1 502 677 3800.'});
 try{const response=await fetch(hook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Delivery failed');}
 catch{return res.status(502).json({error:'We could not deliver your request. Please try again or email info@bpohive.com.'});}
 return res.status(200).json({accepted:true,qualified,reviewPending:type==='strategy'&&!qualified,bookingUrl,resourceUrl,workflowDelivered:true});
};
module.exports.website=website;
