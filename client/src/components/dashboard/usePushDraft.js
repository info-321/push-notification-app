import {useCallback,useEffect,useRef,useState} from 'react';
import {API_BASE,apiFetch} from '../../api';

export default function usePushDraft({domainKey,ready,copyId,content,enabled,sending,finished,onRestore}) {
  const version=useRef(0),lastSaved=useRef(''),inFlight=useRef(null),generation=useRef(0);
  const [loaded,setLoaded]=useState(false),[blocked,setBlocked]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const serialized=JSON.stringify(content),route=`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/draft`;
  useEffect(()=>{
    if(!ready)return;
    let cancelled=false;
    const current=++generation.current;setLoaded(false);setBlocked(false);
    apiFetch(route).then(async r=>{const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.message||'Could not load draft.');if(cancelled||current!==generation.current)return;
      const row=result.data;version.current=row?.version || 0;
      if(row?.content&&Number.isSafeInteger(row.version)&&!copyId){onRestore(row.content);lastSaved.current=JSON.stringify(row.content);setStatus('Your saved draft was restored. Review it before sending.');}
      else{lastSaved.current='';setStatus('Draft changes will be saved to your account automatically.');}
      setLoaded(true);
    }).catch(()=>{if(!cancelled&&current===generation.current){setBlocked(true);setStatus('Draft storage could not be loaded. Reload this page to restore saved work. Changes in this tab are not saved yet.');}});
    return()=>{cancelled=true;};
  },[ready,route,copyId,onRestore]);
  const save=useCallback(async()=>{
    if(!loaded)return false;
    if(inFlight.current)await inFlight.current;
    if(serialized===lastSaved.current)return true;
    const current=generation.current;setBusy(true);setStatus('Saving draft…');
    const task=(async()=>{try{const r=await apiFetch(route,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:version.current,content:JSON.parse(serialized)})}),result=await r.json();if(current!==generation.current)return false;if(!r.ok||!result.ok)throw new Error(result.message||'Could not save draft.');version.current=result.data.version;lastSaved.current=serialized;setBlocked(false);setStatus(`Draft saved · ${new Date(result.data.updated_ms).toLocaleTimeString()}`);return true;}catch(e){if(current===generation.current){setBlocked(true);setStatus(e.message+' Your unsaved changes remain in this tab.');}return false;}finally{inFlight.current=null;if(current===generation.current)setBusy(false);}})();
    inFlight.current=task;return task;
  },[loaded,serialized,route]);
  useEffect(()=>{if(!ready||!loaded||!enabled||sending||finished||blocked||busy||serialized===lastSaved.current)return;setStatus('Unsaved changes…');const timer=setTimeout(save,1000);return()=>clearTimeout(timer);},[ready,loaded,enabled,sending,finished,blocked,busy,serialized,save]);
  useEffect(()=>{if(!enabled||finished||serialized===lastSaved.current)return;const warn=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[enabled,finished,serialized,busy]);
  const discard=async()=>{
    if(inFlight.current)await inFlight.current;
    if(version.current){const r=await apiFetch(`${route}?version=${version.current}`,{method:'DELETE'}),result=await r.json();if(!r.ok||!result.ok)throw new Error(result.message||'Could not remove draft.');}
    version.current=0;lastSaved.current='';setBlocked(false);setStatus('Saved draft cleared.');
  };
  return {status,busy,save,discard,loaded};
}
