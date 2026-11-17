import React,{useState} from 'react';
import {API_BASE,apiFetch,authChanged} from '../../api';
export default function Recovery({kind,token='',onBack}){
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const submit=async event=>{
    event.preventDefault();if(busy)return;setError('');
    if(kind==='reset'&&(password.length<12||password.length>128||password!==confirm)){setError('Use 12-128 characters and make sure both passwords match.');return;}
    setBusy(true);const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{const path=kind==='forgot'?'forgot-password':kind==='reset'?'reset-password':'verify-email';const r=await apiFetch(`${API_BASE}/api/auth/${path}`,{method:'POST',authFailure:false,headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='forgot'?{username}:{token,...(kind==='reset'?{password}:{})}),signal:controller.signal}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Could not complete this request.');if(kind==='reset'){localStorage.removeItem('auth');authChanged();}setPassword('');setConfirm('');setMessage(d.message);}catch(e){setError(e.name==='AbortError'?'The request timed out. Try again.':e.message||'Could not connect. Try again.');}finally{clearTimeout(timeout);setBusy(false);}
  };
  return <div className="login-recovery"><span className="login-eyebrow">ACCOUNT RECOVERY</span><h1>{kind==='forgot'?'Forgot password?':kind==='reset'?'Choose a new password':'Verify recovery email'}</h1><p>{kind==='forgot'?'Enter your username. We will send a link to your verified recovery email if one is set.':kind==='reset'?'Your link can be used once. Resetting your password signs out all existing sessions.':'Confirm this address so you can recover your account by email.'}</p>
    {error&&<p className="login-error" role="alert">{error}</p>}{message?<p className="login-notice" role="status">{message}</p>:<form className="login-form" onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0}}>
      {kind==='forgot'&&<div className="login-field"><label htmlFor="recovery-username">Username</label><input id="recovery-username" autoComplete="username" value={username} maxLength={255} required onChange={e=>setUsername(e.target.value)}/></div>}
      {kind==='reset'&&<><div className="login-field"><label htmlFor="reset-password">New password</label><input id="reset-password" type={visible?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></div><div className="login-field"><label htmlFor="reset-confirm">Confirm new password</label><input id="reset-confirm" type={visible?'text':'password'} autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/></div><label className="login-remember"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/>Show passwords</label></>}
      <button className="login-submit" type="submit">{busy?'Please wait...':kind==='forgot'?'Send reset link':kind==='reset'?'Reset password':'Verify email address'}</button></fieldset></form>}
    <button className="login-forgot" onClick={onBack} disabled={busy}>Back to sign in</button>
  </div>;
}
