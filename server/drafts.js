import { parsePushAudience } from './push-audience.js';
import { validSelection, targetDevices, targetBrowsers } from './targeting.js';

export function validDraft(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || JSON.stringify(value).length>20000) return false;
  if(Object.keys(value).some(key=>!['draft','selected','platform','subscribed','targetDevices','targetBrowsers','webEnabled','sendMode','schedule','step'].includes(key)))return false;
  const d=value.draft;
  if(Object.keys(d||{}).some(key=>!['title','body','url','icon','banner'].includes(key)))return false;
  if(!d || ['title','body','url','icon'].some(key=>typeof d[key]!=='string'))return false;
  if(d.title.length>150||d.body.length>1000||d.url.length>2048||d.icon.length>2048)return false;
  if(!d.banner||typeof d.banner.enabled!=='boolean'||typeof d.banner.image!=='string'||d.banner.image.length>2048||!Array.isArray(d.banner.actions)||d.banner.actions.length>2)return false;
  if(Object.keys(d.banner).some(key=>!['enabled','image','actions'].includes(key)))return false;
  if(d.banner.actions.some(a=>!a||Object.keys(a).some(key=>!['title','url','type'].includes(key))||typeof a.title!=='string'||a.title.length>40||typeof a.url!=='string'||a.url.length>2048||!['link','call','facebook','x','whatsapp'].includes(a.type)))return false;
  if(!Array.isArray(value.selected)||value.selected.length>100||new Set(value.selected).size!==value.selected.length||value.selected.some(k=>typeof k!=='string'||!k||k.length>64))return false;
  if(!parsePushAudience({platform:value.platform,subscribed:value.subscribed}))return false;
  for(const [field,choices] of [['targetDevices',targetDevices],['targetBrowsers',targetBrowsers]])if(value[field]!=='all'&&!validSelection(value[field],choices,true))return false;
  const schedule=value.schedule;
  if(!schedule||typeof schedule!=='object'||Array.isArray(schedule)||Object.keys(schedule).some(key=>!['kind','time_zone','start','frequency','interval','weekdays','end_mode','count','end_date'].includes(key)))return false;
  for(const [key,item] of Object.entries(schedule)){
    if(key==='weekdays'){if(!Array.isArray(item)||item.length>7||item.some(day=>!Number.isInteger(day)||day<0||day>6))return false;}
    else if(['interval','count'].includes(key)){if(typeof item!=='number'||!Number.isFinite(item))return false;}
    else if(typeof item!=='string'||item.length>128)return false;
  }
  return [2,3].includes(value.step)&&['now','once','recurring'].includes(value.sendMode)&&typeof value.webEnabled==='boolean';
}
export function installDrafts(app,{pool,requireAdmin,security}) {
  app.get('/api/domains/:key/draft',requireAdmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{const [rows]=await pool.query('SELECT version,content,updated_ms FROM notification_drafts WHERE user_id=? AND domain_key=?',[req.auth.id,req.params.key]);const row=rows[0];res.json({ok:true,data:row?{version:row.version,content:typeof row.content==='string'?JSON.parse(row.content):row.content,updated_ms:Number(row.updated_ms)}:null});}
    catch{res.status(503).json({ok:false,message:'Could not load your saved draft.'});}
  });
  app.put('/api/domains/:key/draft',requireAdmin,async(req,res)=>{
    const {version,content}=req.body||{};
    if(!Number.isSafeInteger(version)||version<0||!validDraft(content))return res.status(400).json({ok:false,message:'This draft contains invalid or oversized fields.'});
    if(content.selected.some(key=>!security.domainAllowed(req,key,true)))return res.status(403).json({ok:false,message:'A selected website is outside your access.'});
    try{
      const [domains]=await pool.query('SELECT domain_key FROM domains WHERE user_id=1');
      if(!domains.some(d=>d.domain_key===req.params.key)||content.selected.some(key=>!domains.some(d=>d.domain_key===key)))return res.status(404).json({ok:false,message:'A selected website is no longer available.'});
      const updated=Date.now();
      if(version===0){try{await pool.query('INSERT INTO notification_drafts (user_id,domain_key,version,content,updated_ms) VALUES (?,?,1,?,?)',[req.auth.id,req.params.key,JSON.stringify(content),updated]);}catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({ok:false,message:'Another tab has saved this draft. Reload to resume the latest version.'});throw error;}}
      else{const [r]=await pool.query('UPDATE notification_drafts SET version=version+1,content=?,updated_ms=? WHERE user_id=? AND domain_key=? AND version=?',[JSON.stringify(content),updated,req.auth.id,req.params.key,version]);if(!r.affectedRows)return res.status(409).json({ok:false,message:'Another tab changed this draft. Reload before editing.'});}
      res.json({ok:true,data:{version:version+1,updated_ms:updated}});
    }catch{res.status(503).json({ok:false,message:'Draft could not be saved. Your changes are still in this tab.'});}
  });
  app.delete('/api/domains/:key/draft',requireAdmin,async(req,res)=>{
    const version=Number(req.query.version);if(!Number.isSafeInteger(version)||version<1)return res.status(400).json({ok:false,message:'Reload the draft before deleting.'});
    try{const [r]=await pool.query('DELETE FROM notification_drafts WHERE user_id=? AND domain_key=? AND version=?',[req.auth.id,req.params.key,version]);res.status(r.affectedRows?200:409).json({ok:Boolean(r.affectedRows),message:r.affectedRows?'Draft removed.':'Draft changed in another tab. Reload it first.'});}catch{res.status(503).json({ok:false,message:'Could not remove draft.'});}
  });
}
