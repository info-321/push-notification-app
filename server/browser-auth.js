import crypto from 'node:crypto';

const safe = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function browserAuth({secret,publicApiBase,dashboardOrigins=''}) {
  const secure=new URL(publicApiBase).protocol==='https:';
  const name=secure?'__Host-notizo_session':'notizo_session';
  const preauth=secure?'__Host-notizo_csrf':'notizo_csrf';
  const origins=new Set([new URL(publicApiBase).origin,...dashboardOrigins.split(',').map(s=>s.trim()).filter(Boolean)]);
  if(!secure){origins.add('http://localhost:3000');origins.add('http://127.0.0.1:3000');}
  for(const origin of origins)if(new URL(origin).origin!==origin)throw new Error('DASHBOARD_ORIGINS must contain exact origins.');
  const options={httpOnly:true,secure,sameSite:'lax',path:'/'};
  const cookie=(req,key)=>{
    const values=(req.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(key+'='));
    if(values.length!==1)return '';
    const value=values[0].slice(key.length+1);return value.length<4096?value:'';
  };
  const session=req=>cookie(req,name);
  const csrf=value=>crypto.createHmac('sha256',secret).update('browser-csrf:'+value).digest('base64url');
  const originAllowed=req=>!req.get('Origin')||origins.has(req.get('Origin'));
  const validCsrf=req=>{
    if(!originAllowed(req)||req.get('Sec-Fetch-Site')==='cross-site')return false;
    const value=session(req)||cookie(req,preauth);
    return Boolean(value&&safe(req.get('X-CSRF-Token'),csrf(value)));
  };
  return {name,secure,session,csrf,origins,originAllowed,validCsrf,
    issue(res,token){const expiry=JSON.parse(Buffer.from(token.split('.')[0],'base64url')).exp;if(!Number.isFinite(expiry)||expiry<=Date.now())throw new Error('Invalid session expiry.');res.cookie(name,token,{...options,maxAge:Math.min(24*3600000,expiry-Date.now())});res.clearCookie(preauth,options);return csrf(token);},
    clear(res){res.clearCookie(name,options);res.clearCookie(preauth,options);},
    bootstrap(req,res){const value=session(req)||crypto.randomBytes(32).toString('base64url');if(!session(req))res.cookie(preauth,value,{...options,maxAge:3600000});return csrf(value);},
    guard(req,res,next){if(!validCsrf(req))return res.status(403).json({ok:false,code:'CSRF',message:'Reload this page before trying again.'});next();},
  };
}
