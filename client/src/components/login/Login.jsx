import React,{useCallback,useEffect,useRef,useState} from 'react';
import {API_BASE,apiFetch,acceptSession,authEpoch,authChanged} from '../../api';
import Recovery from './Recovery';
import AccessHelp from './AccessHelp';
import './login.css';

const recoveryFromUrl=()=>{const hash=new URLSearchParams(window.location.hash.slice(1));const kind=hash.has('reset')?'reset':hash.has('verify')?'verify':null;return kind?{kind,token:hash.get(kind)}:null;};
const rememberedKey='notizo.rememberedUsername';
const rememberedUsername=()=>{try{return localStorage.getItem(rememberedKey)?.slice(0,255)||'';}catch{return '';}};
function Eye({visible}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg>;
}
function FeatureIcon({type}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='send'?<path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3"/>:type==='chart'?<><path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6"/></>:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v16m4-7h5m-5 3h3"/></>}</svg>;
}

export default function Login({onLoginSuccess,notice=''}) {
  const [recovery,setRecovery]=useState(recoveryFromUrl);
  useEffect(()=>{const changed=()=>{const link=recoveryFromUrl();if(link){window.history.replaceState({},'','/login');setRecovery(link);}};changed();window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  const [username,setUsername]=useState(rememberedUsername),[password,setPassword]=useState('');
  const [remember,setRemember]=useState(()=>Boolean(rememberedUsername())),[showPassword,setShowPassword]=useState(false),[capsLock,setCapsLock]=useState(false);
  const [error,setError]=useState(''),[invalid,setInvalid]=useState(''),[loading,setLoading]=useState(false),[help,setHelp]=useState(false);
  const [retryUntil,setRetryUntil]=useState(0),[clock,setClock]=useState(Date.now());
  const lock=useRef(false),active=useRef(true),request=useRef(null),errorRef=useRef(null),usernameRef=useRef(null),passwordRef=useRef(null),helpButton=useRef(null);
  const retrySeconds=Math.max(0,Math.ceil((retryUntil-clock)/1000));
  const closeHelp=useCallback(()=>setHelp(false),[]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
  useEffect(()=>{if(!retryUntil)return;const timer=setInterval(()=>{setClock(Date.now());if(Date.now()>=retryUntil)setRetryUntil(0);},1000);return()=>clearInterval(timer);},[retryUntil]);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const edit=(setter,value)=>{setter(value);setError('');setInvalid('');};
  const checkCaps=event=>setCapsLock(Boolean(event.getModifierState?.('CapsLock')));

  const submit=async event=>{
    event.preventDefault();
    if(lock.current||Date.now()<retryUntil)return;
    setError('');setInvalid('');
    const name=username.trim();
    if(!name){setInvalid('username');setError('Enter your username to continue.');usernameRef.current?.focus();return;}
    if(!password){setInvalid('password');setError('Enter your password to continue.');passwordRef.current?.focus();return;}
    if(navigator.onLine===false){setError('You appear to be offline. Reconnect to the internet and try again.');return;}
    lock.current=true;setLoading(true);
    const controller=new AbortController();request.current=controller;let timedOut=false;const previousEpoch=authEpoch();
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    try {
      const response=await apiFetch(`${API_BASE}/api/login`,{authFailure:false,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password}),signal:controller.signal});
      if(!active.current)return;
      if(response.status===429){
        const retry=Number(response.headers?.get('Retry-After'));
        setRetryUntil(Date.now()+(Number.isFinite(retry)&&retry>0?Math.min(retry,3600):900)*1000);setClock(Date.now());
        throw Object.assign(new Error('Too many sign-in attempts. Please wait before trying again.'),{handled:true});
      }
      if(response.status===401||response.status===403){setInvalid('credentials');throw Object.assign(new Error("We couldn't sign you in. Check your username and password, or ask your administrator for help."),{handled:true});}
      if(!response.ok)throw Object.assign(new Error('Sign-in is temporarily unavailable. Please try again shortly.'),{handled:true});
      const data=await response.json().catch(()=>null);
      if(!data?.ok||typeof data.csrfToken!=='string'||!data.csrfToken)throw Object.assign(new Error('Sign-in could not be completed. Please try again.'),{handled:true});
      if(!active.current||controller.signal.aborted)return;
      if(authEpoch()!==previousEpoch)throw Object.assign(new Error('Your sign-in changed in another tab. Reload this page to continue.'),{handled:true});
      acceptSession(data);localStorage.setItem('auth','true');authChanged();
      try{if(remember)localStorage.setItem(rememberedKey,name);else localStorage.removeItem(rememberedKey);}
      catch{throw Object.assign(new Error('Allow site storage in your browser settings to sign in.'),{handled:true});}
      await onLoginSuccess?.({signal:controller.signal});
      if(active.current)setPassword('');
    }catch(err){
      if(!active.current)return;
      setError(timedOut?'The sign-in request timed out. Check your connection and try again.':err.handled?err.message:err.name==='AbortError'?'Sign-in was interrupted. Please try again.':'Could not connect to Notizo. Check your connection and try again.');
    }finally{clearTimeout(timeout);lock.current=false;if(active.current)setLoading(false);}
  };

  return <main className="login-page"><div className="login-shell">
    <aside className="login-story" aria-label="About Notizo">
      <div className="login-brand"><span className="login-brand-mark"><img src="/notizo-icon.svg" alt="" width="44" height="44"/></span><span>Notizo</span></div>
      <div className="login-story-copy"><span className="login-eyebrow">YOUR PUSH WORKSPACE</span><h2>Every audience.<br/>One workspace.</h2><p>Bring your websites, notifications and audience insights together.</p></div>
      <div className="login-features"><div><FeatureIcon type="send"/><span><strong>Create</strong><small>Send the right notification.</small></span></div><div><FeatureIcon type="chart"/><span><strong>Understand</strong><small>See how your audience responds.</small></span></div><div><FeatureIcon type="manage"/><span><strong>Manage</strong><small>Keep your websites connected.</small></span></div></div>
      <p className="login-story-footer">Your websites. Your audience. Your workspace.</p>
    </aside>
    <section className="login-form-panel" aria-labelledby="login-title">
      {recovery?<Recovery key={recovery.kind+recovery.token} {...recovery} onBack={()=>setRecovery(null)}/>:<><header><span className="login-eyebrow">WORKSPACE SIGN IN</span><h1 id="login-title">Welcome back <br/>to Notizo</h1><p>Sign in to manage your websites and notifications.</p></header>
      {notice&&<div className="login-notice" role="status">{notice}</div>}
      {error&&<div ref={errorRef} tabIndex={-1} className="login-error" id="login-error" role="alert">{error}</div>}
      <form className="login-form" onSubmit={submit} noValidate aria-busy={loading}>
        <div className="login-field"><label htmlFor="login-username">Username</label><input ref={usernameRef} id="login-username" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={255} placeholder="Enter your username" value={username} required disabled={loading} aria-invalid={invalid==='username'||invalid==='credentials'} aria-describedby={error?'login-error':undefined} onChange={event=>edit(setUsername,event.target.value)}/></div>
        <div className="login-field"><label htmlFor="login-password">Password</label><div className="login-password-wrap"><input ref={passwordRef} id="login-password" name="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" value={password} required disabled={loading} aria-invalid={invalid==='password'||invalid==='credentials'} aria-describedby={[error?'login-error':'',capsLock?'login-caps-lock':''].filter(Boolean).join(' ')||undefined} onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={()=>setCapsLock(false)} onChange={event=>edit(setPassword,event.target.value)}/><button type="button" className="login-password-toggle" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} disabled={loading} onClick={()=>setShowPassword(value=>!value)}><Eye visible={showPassword}/></button></div>{capsLock&&<p className="login-caps" id="login-caps-lock" role="status">Caps Lock is on.</p>}</div>
        <button type="button" className="login-forgot" onClick={()=>setRecovery({kind:'forgot'})}>Forgot password?</button>
        <div className="login-form-options"><label className="login-remember"><input type="checkbox" checked={remember} disabled={loading} onChange={event=>{setRemember(event.target.checked);if(!event.target.checked){try{localStorage.removeItem(rememberedKey);}catch{}}}}/>Remember username</label><span>On this device</span></div>
        <button type="submit" className="login-submit" disabled={loading||retrySeconds>0}>{loading?<><span className="login-spinner" aria-hidden="true"/>Signing in...</>:retrySeconds>0?`Try again in ${Math.floor(retrySeconds/60)}:${String(retrySeconds%60).padStart(2,'0')}`:<>Sign in <span aria-hidden="true">&rarr;</span></>}</button>
        <p className="login-progress" role="status">{loading?'Checking your account and website access.':retrySeconds>0?'Sign-in is temporarily limited. You can try again when the countdown ends.':''}</p>
      </form>
      <footer className="login-form-footer"><p>Use the account provided by your administrator.</p><button ref={helpButton} type="button" onClick={()=>setHelp(true)}>Need access? Contact your administrator <span aria-hidden="true">&#8599;</span></button><small>&ldquo;Remember username&rdquo; never saves your password.</small></footer></>}
    </section>
  </div>{help&&<AccessHelp onClose={closeHelp} returnFocus={helpButton}/>}</main>;
}
