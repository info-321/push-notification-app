import React,{useEffect,useRef,useState} from 'react';
import {API_BASE,apiFetch,acceptSession} from '../../api';
import './platform.css';

async function json(path,body){
  const response=await apiFetch(API_BASE+path,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.message||'Security request failed.');acceptSession(data);return data;
}
export function ConfirmAction(){
  const [task,setTask]=useState(null),[password,setPassword]=useState(''),[code,setCode]=useState(''),[mfa,setMfa]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef(null),origin=useRef(null),pending=useRef(null);
  useEffect(()=>{
    const receive=event=>{if(pending.current){event.detail.reject(new Error('Complete the current confirmation first.'));return;}origin.current=document.activeElement;pending.current=event.detail;setTask(event.detail);setPassword('');setCode('');setError('');setMfa(true);json('/api/account/mfa').then(d=>setMfa(d.data.enabled)).catch(e=>setError(e.message));};
    const cancel=()=>{pending.current?.reject(new Error('Your sign-in changed. Confirm again.'));pending.current=null;setTask(null);setPassword('');setCode('');};
    window.addEventListener('notizo-auth-changed',cancel);window.addEventListener('notizo-confirm',receive);return()=>{window.removeEventListener('notizo-auth-changed',cancel);window.removeEventListener('notizo-confirm',receive);pending.current?.reject(new Error('Confirmation closed.'));};
  },[]);
  useEffect(()=>{if(task){dialog.current?.showModal();dialog.current?.querySelector('input')?.focus();}else dialog.current?.close();},[task]);
  const close=(error=new Error('Action cancelled.'))=>{pending.current?.reject(error);pending.current=null;setTask(null);setPassword('');setCode('');origin.current?.focus();};
  const submit=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const d=await json('/api/account/step-up',{password,code,request:task.request});task.resolve(d.approval);pending.current=null;setTask(null);setPassword('');setCode('');origin.current?.focus();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <dialog ref={dialog} className="platform-confirm" onCancel={e=>{e.preventDefault();if(!busy)close();}}>{task&&<form onSubmit={submit}><h2>Confirm protected action</h2><p>{task?.label||'Confirm this change to your platform.'}</p><p>Use a new authenticator code for each action. Codes cannot be reused.</p><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label>{mfa&&<label>Authenticator or recovery code<input autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.trim())} required maxLength={24} disabled={busy}/></label>}{error&&<p role="alert">{error}</p>}<div className="platform-actions"><button type="button" onClick={()=>close()} disabled={busy}>Cancel</button><button className="security-primary" disabled={busy}>{busy?'Confirming...':'Confirm'}</button></div></form>}</dialog>;
}
export default function MfaSettings({login=false,onDone,onCancel}){
  const [info,setInfo]=useState(null),[setup,setSetup]=useState(null),[codes,setCodes]=useState(null),[password,setPassword]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;json('/api/account/mfa').then(d=>{if(active)setInfo(d.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const act=async action=>{if(busy)return;setBusy(true);setError('');try{
    const path=action==='verify'?'/api/auth/mfa/verify':`/api/account/mfa/${action}`;
    const d=await json(path,{password,code});setCode('');
    if(action==='start')setSetup(d.data);
    else if(action==='verify'){setPassword('');await onDone?.();}
    else {setSetup(null);setPassword('');setCodes(d.data?.recovery_codes||null);setSaved(false);const status=await json('/api/account/mfa');setInfo(status.data);setNotice(d.message||'Security settings updated.');}
  }catch(e){setError(e.message);}finally{setBusy(false);}};
  const needsSetup=login&&!info?.enabled;
  return <section className="account-panel security-panel platform-mfa"><h2>{login?'Secure your sign-in':'Two-factor authentication'}</h2>
    {error&&<p role="alert" className="security-error">{error}</p>}{notice&&!codes&&<p role="status">{notice}</p>}
    {!info?<><p>Loading security settings...</p>{login&&onCancel&&<button type="button" onClick={onCancel}>Back to sign in</button>}</>:codes?<><p>Save these single-use recovery codes in your password manager. They will not be shown again.</p><div className="platform-codes">{codes.map(c=><code key={c}>{c}</code>)}</div><label><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/> I saved my recovery codes privately</label><button className="security-primary" disabled={!saved||busy} onClick={async()=>{if(!login){setCodes(null);return;}setBusy(true);try{await onDone?.();}catch(e){setError(e.message||'Could not finish signing in.');}finally{setBusy(false);}}}>Continue</button></>:<>
      <p>{info.required?'Two-factor authentication is required for your role. ':'Add an authenticator to protect your account. '}{login&&info.enabled?'Enter your authenticator code or a saved recovery code.':'Use a trusted authenticator app. Keep your recovery codes private.'}</p>
      {setup&&<div className="platform-enrollment"><img src={setup.qr} alt="Authenticator setup QR code"/><p>Scan with your authenticator, or enter this setup key manually:</p><code>{setup.secret}</code><p>The setup expires in 10 minutes.</p></div>}
      <form onSubmit={e=>{e.preventDefault();act(login&&info.enabled?'verify':setup?'enable':!info.enabled?'start':'recovery-codes');}}>
        {(!login||needsSetup)&&<label>Current password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>}
        {(info.enabled||setup)&&<label>Authenticator{!setup?' or recovery':''} code<input required maxLength={24} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.trim())} disabled={busy}/></label>}
        <div className="platform-actions"><button className="security-primary" disabled={busy}>{busy?'Checking...':login&&info.enabled?'Verify sign-in':setup?'Enable two-factor authentication':info.enabled?'Replace recovery codes':'Set up authenticator'}</button>
        {!login&&info.enabled&&!info.required&&<button type="button" disabled={busy||!password||!code} onClick={()=>act('disable')}>Disable two-factor authentication</button>}
        {login&&onCancel&&<button type="button" disabled={busy} onClick={onCancel}>Back to sign in</button>}</div>
      </form></>}
  </section>;
}
