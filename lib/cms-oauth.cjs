const crypto=require('node:crypto');
const ORIGIN='https://www.bpohive.com';
const CALLBACK=ORIGIN+'/api/cms/callback';
const REPO='amresmat/bpohive-website-final';
const COOKIE='__Secure-bpohive-cms-state';
function config(){const {CMS_GITHUB_CLIENT_ID:id,CMS_GITHUB_CLIENT_SECRET:secret,CMS_STATE_SECRET:stateSecret}=process.env;if(!id||!secret||!stateSecret||stateSecret.length<32)throw Error('CMS is not configured');return{id,secret,stateSecret};}
const random=()=>crypto.randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function seal(data,key){const body=Buffer.from(JSON.stringify(data)).toString('base64url');return body+'.'+crypto.createHmac('sha256',key).update(body).digest('base64url');}
function unseal(value,key){if(typeof value!=='string'||value.length>2000)throw Error('Invalid state');const [body,sig,...rest]=value.split('.');if(rest.length||!equal(sig,crypto.createHmac('sha256',key).update(body).digest('base64url')))throw Error('Invalid state');const data=JSON.parse(Buffer.from(body,'base64url'));if(!Number.isFinite(data.at)||Date.now()-data.at>600000||data.at>Date.now())throw Error('Expired state');return data;}
function cookie(value,age=600){return `${COOKIE}=${value}; Path=/api/cms; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
function headers(res){res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');}
function popup(res,kind,data){const nonce=random();headers(res);res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);const payload=JSON.stringify(`authorization:github:${kind}:${JSON.stringify(data)}`).replace(/</g,'\\u003c');res.statusCode=kind==='success'?200:400;res.end(`<!doctype html><html><title>BPO Hive sign-in</title><body><p>${kind==='success'?'Sign-in complete. You can close this window.':'Sign-in could not be completed. Close this window and try again.'}</p><script nonce="${nonce}">const origin=${JSON.stringify(ORIGIN)};if(window.opener){window.addEventListener('message',function receive(event){if(event.origin!==origin||event.source!==window.opener)return;window.removeEventListener('message',receive);window.opener.postMessage(${payload},origin);window.close();});window.opener.postMessage('authorizing:github',origin);}</script></body></html>`);}
module.exports={ORIGIN,CALLBACK,REPO,COOKIE,config,random,equal,seal,unseal,cookie,headers,popup};
