import React,{useEffect,useRef,useState} from 'react';
export default function AccessHelp({onClose,returnFocus}) {
  const panel=useRef(null),[copied,setCopied]=useState(false);
  const request='Hello, I would like access to Notizo.\nName: \nWebsites I need to manage: \nPlease let me know which account and permissions I should use.';
  useEffect(()=>{
    const target=panel.current,previous=returnFocus?.current;target.querySelector('button')?.focus();
    const keydown=event=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const items=Array.from(target.querySelectorAll('button,a,textarea')).filter(item=>!item.disabled);
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    target.addEventListener('keydown',keydown);
    return()=>{target.removeEventListener('keydown',keydown);previous?.focus();};
  },[onClose,returnFocus]);
  return <div className="login-help-overlay" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section ref={panel} className="login-help" role="dialog" aria-modal="true" aria-labelledby="login-help-title" aria-describedby="login-help-description">
    <button type="button" className="login-help-close" aria-label="Close access help" onClick={onClose}>&times;</button>
    <span className="login-eyebrow">ACCOUNT ACCESS</span><h2 id="login-help-title">Need an account?</h2>
    <p id="login-help-description">Contact the person who manages Notizo for your organisation. They can create your account and assign website access in <strong>Settings &rarr; User</strong>.</p>
    <p className="login-contact-links"><a href="mailto:ttwabhijit@gmail.com?subject=Notizo%20access%20request">ttwabhijit@gmail.com</a><a href="mailto:kaushik@travelandtourworld.com?subject=Notizo%20access%20request">kaushik@travelandtourworld.com</a></p>
    <p>Share your name and the websites you need to manage. You can copy this request and send it through your usual work contact.</p>
    <label htmlFor="login-access-request">Access request</label><textarea id="login-access-request" readOnly value={request} onFocus={event=>event.target.select()}/>
    <button type="button" className="login-submit" onClick={async()=>{try{await navigator.clipboard.writeText(request);if(panel.current)setCopied(true);}catch{panel.current?.querySelector('textarea')?.focus();if(panel.current)setCopied(false);}}}>Copy access request</button>
    <p role="status" className="login-help-copy-status">{copied?'Copied. Send it to your administrator.':'You can also select the text and copy it manually.'}</p>
  </section></div>;
}
