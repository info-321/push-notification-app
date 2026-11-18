// Privileged identity history stays private even after a role is changed.
// This registry contains account IDs, never credentials or activity bodies.
const registry='private_account_ids';
export function privateAccountIds(data){
  const saved=data.config[registry]?JSON.parse(data.config[registry]):[];
  if(!Array.isArray(saved)||saved.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Invalid account visibility settings.');
  return new Set([...saved,...Object.values(data.users).filter(u=>u.role==='superadmin').map(u=>Number(u.id)),...(data.state.owner_id?[Number(data.state.owner_id)]:[])]);
}
export function rememberPrivateAccounts(data,before=data){
  data.config[registry]=JSON.stringify([...new Set([...privateAccountIds(before),...privateAccountIds(data)])].sort((a,b)=>a-b));
}
export function accountVisible(data,actor,user){
  return Boolean(user&&(actor.role==='superadmin'||!privateAccountIds(data).has(Number(user.id))));
}
export function privateAccountNames(data){
  const ids=privateAccountIds(data);
  return Object.values(data.users).filter(u=>ids.has(Number(u.id))).map(u=>u.username.toLowerCase());
}
export function historyVisible(data,actor,row,type){
  if(actor.role==='superadmin')return true;
  const id=Number(type==='login'?row.user_id:row.actor_id),name=type==='login'?row.username:row.actor_name;
  return !privateAccountIds(data).has(id)&&!privateAccountNames(data).includes(String(name||'').trim().toLowerCase());
}
export function publicActivity(row,actor){
  if(actor.role==='superadmin')return row;
  // Audit attempts remain visible without exposing the target account details.
  if(/^\/api\/(users|platform)(?:\/|$|\s)/.test(row.action))return {...row,action:'Account management',domain_key:null};
  return row;
}
