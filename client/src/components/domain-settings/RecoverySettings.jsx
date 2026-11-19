import React,{useEffect,useRef,useState} from 'react';
import {API_BASE,apiFetch} from '../../api';

export default function RecoverySettings(){
  const [data,setData]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [loadError,setLoadError]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const initialized=useRef(false),submission=useRef(null),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;submission.current?.abort();};},[]);
  useEffect(()=>{
    let current=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    setLoading(true);setLoadError('');
    apiFetch(`${API_BASE}/api/account/recovery`,{signal:controller.signal}).then(async r=>{
      const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.message||'Could not load recovery settings.');
      if(current){setData(result.data);if(!initialized.current){setEmail(result.data.pending_email||result.data.verified_email||'');initialized.current=true;}}
    }).catch(e=>{if(current)setLoadError(e.name==='AbortError'?'Loading timed out. Refresh the recovery status to try again.':e.message);})
      .finally(()=>{clearTimeout(timeout);if(current)setLoading(false);});
    return()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[reload]);
  const save=async event=>{
    event.preventDefault();if(submission.current||busy||loading||!data?.mail_enabled)return;
    const address=email.trim().toLowerCase();if(!address||!password)return;
    const controller=new AbortController();submission.current=controller;
    const timeout=setTimeout(()=>controller.abort(),15000);setBusy(true);setError('');setMessage('');
    try{
      const r=await apiFetch(`${API_BASE}/api/account/recovery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,password}),signal:controller.signal}),result=await r.json();
      if(!r.ok||!result.ok)throw new Error(result.message||'Could not send verification.');
      if(active.current){setData(previous=>({...previous,pending_email:address}));setMessage(result.message||'Verification email sent. Open the link in your inbox, then refresh the recovery status here.');}
    }catch(e){if(active.current)setError(e.name==='AbortError'?'The request timed out. Check your inbox before requesting another verification email.':e.message);}
    finally{clearTimeout(timeout);submission.current=null;if(active.current){setPassword('');setBusy(false);}}
  };
  return <section className="account-panel security-panel recovery-settings" aria-labelledby="recovery-email-heading">
    <div className="security-heading"><h2 id="recovery-email-heading">Recovery email</h2><button type="button" disabled={busy||loading} onClick={()=>{setMessage('');setReload(value=>value+1);}}>{loading?'Loading recovery status...':'Refresh recovery status'}</button></div>
    <p>Set a private recovery address for your own Notizo account. It applies across all your websites. Forgot password sends a reset link to your verified address.</p>
    {loadError&&<p className="account-error" role="alert">{loadError}</p>}{error&&<p className="account-error" role="alert">{error}</p>}{message&&<p className="account-success" role="status">{message}</p>}
    {data&&<><dl className="recovery-status"><div><dt>Verified recovery address</dt><dd>{data.verified_email||'Not set'}</dd></div>{data.pending_email&&<div><dt>Awaiting verification</dt><dd>{data.pending_email}</dd></div>}</dl>
      {data.pending_email&&<p>Open the verification email within 30 minutes, then click Refresh recovery status. Your existing verified address stays active until the replacement is verified.</p>}
      {!data.mail_enabled&&<p className="account-note">Email delivery is unavailable. Contact your administrator before setting a recovery address.</p>}
      <form onSubmit={save} className="security-user-form"><label htmlFor="recovery-email-address">Recovery email address<input id="recovery-email-address" type="email" autoComplete="email" value={email} maxLength={254} required disabled={busy||loading||!data.mail_enabled||Boolean(loadError)} onChange={e=>setEmail(e.target.value)}/></label>
        <label htmlFor="recovery-current-password">Current Notizo password<input id="recovery-current-password" type="password" autoComplete="current-password" value={password} maxLength={1024} required disabled={busy||loading||!data.mail_enabled||Boolean(loadError)} onChange={e=>setPassword(e.target.value)}/></label>
        <div className="security-form-actions"><button type="submit" className="account-save security-primary" disabled={busy||loading||!data.mail_enabled||Boolean(loadError)}>{busy?'Sending verification...':'Send verification email'}</button></div>
      </form></>}
  </section>;
}
