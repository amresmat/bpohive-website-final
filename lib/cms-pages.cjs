// Pages shown in the content admin's sign-in window.
const c = require('./cms-oauth.cjs');

// The admin can run on the live domain or on this project's Vercel previews.
function originOf(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const ok = h === 'www.bpohive.com' || h === 'bpohive.com' || /^bpohive-website-final[a-z0-9-]*-bpo-hive\.vercel\.app$/.test(h);
  return 'https://' + (ok ? h : 'www.bpohive.com');
}

function page(res, nonce, body, script) {
  c.headers(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  res.statusCode = 200;
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BPO Hive admin sign-in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f9fc;color:#0d1d2b;font:15px/1.5 Inter,"Helvetica Neue",Arial,sans-serif}.box{width:min(360px,calc(100% - 32px));padding:28px;border:1px solid #dbe8f0;border-radius:12px;background:#fff}img{height:32px;margin-bottom:16px}label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#344d5c}input{height:46px;padding:0 12px;border:1px solid #dbe8f0;border-radius:6px;font:inherit}button,a.btn{display:flex;align-items:center;justify-content:center;width:100%;height:48px;margin-top:16px;border:0;border-radius:6px;background:#0f7ac4;color:#fff;font:600 15px Inter,Arial,sans-serif;text-decoration:none;cursor:pointer}p{color:#5d7280}.err{min-height:20px;color:#c0392b;font-size:14px}</style></head><body><div class="box"><img src="/assets/logo/bpohivelogo.png" alt="BPO Hive">${body}</div>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`);
}

function login(res) {
  page(res, c.random(), '<form id="f"><label>Admin password<input type="password" name="password" autocomplete="current-password" required autofocus></label><button type="submit">Sign in</button><p class="err" id="e" role="alert"></p></form>',
    "document.getElementById('f').addEventListener('submit',function(ev){ev.preventDefault();var e=document.getElementById('e');e.textContent='';fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:this.password.value})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Sign in failed');location.reload();});}).catch(function(x){e.textContent=x.message;});});");
}

function connect(res) {
  page(res, c.random(), '<p><b>One-time setup.</b> Connect the GitHub account that owns the website code. After this, everyone signs in with the admin password only.</p><a class="btn" href="/api/cms/auth?connect=1">Connect GitHub</a><p style="font-size:13px">This step only works on www.bpohive.com.</p>', '');
}

// Hands the content admin a placeholder key. The real GitHub key never leaves the server.
function success(req, res) {
  const nonce = c.random();
  const origin = originOf(req);
  const payload = JSON.stringify('authorization:github:success:' + JSON.stringify({ token: 'session', provider: 'github' })).replace(/</g, '\\u003c');
  page(res, nonce, '<p>Signed in. You can close this window.</p>',
    `var origin=${JSON.stringify(origin)};if(window.opener){window.addEventListener('message',function receive(event){if(event.origin!==origin||event.source!==window.opener)return;window.removeEventListener('message',receive);window.opener.postMessage(${payload},origin);window.close();});window.opener.postMessage('authorizing:github',origin);}else{location.replace('/admin/');}`);
}

module.exports = { login, connect, success, originOf };
