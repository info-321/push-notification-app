import {assertActor,rotateAccess} from './platform-store.js';
import {accountEvent,addAccountEvent} from './account-events.js';
import {appError} from './platform-crypto.js';
export function managedResetStore(){return {
  async startManagedReset(auth,id,tokenHash,unusablePasswordHash,reason){
    return this.platformAtomic(d=>{
      const actor=assertActor(d,auth),user=d.users[id];
      if(!d.state.enabled||actor.role!=='superadmin'||!d.mfa[actor.id]?.enabled)throw appError('This action is unavailable.',403);
      if(!user?.is_active)throw appError('Choose an active account.',404);
      if(user.id===actor.id)throw appError('Use Account to change your own password.');
      const now=Date.now();user.password_hash=unusablePasswordHash;user.password_changed_at=new Date(now);rotateAccess(user);
      d.sessionReasons={[user.id]:'password_reset'};
      d.config[`reset-link:${tokenHash}`]=JSON.stringify({user_id:user.id,version:user.session_version,expires_ms:now+900000,used_ms:null,requested_by:{id:actor.id,username:actor.username}});
      addAccountEvent(d,accountEvent('password_reset_requested',actor,user,{source:'owner_reset',reason}));
      return {username:user.username,expires_ms:now+900000};
    });
  },
  async redeemManagedReset(tokenHash,passwordHash){
    const key=`reset-link:${tokenHash}`;
    if(!await this.platformConfig(key))return false;
    return this.platformAtomic(d=>{
      const token=JSON.parse(d.config[key]||'null'),user=d.users[token?.user_id];
      if(!token||token.used_ms||token.expires_ms<=Date.now()||!user?.is_active||user.session_version!==token.version)return false;
      user.password_hash=passwordHash;user.password_changed_at=new Date();rotateAccess(user);token.used_ms=Date.now();d.config[key]=JSON.stringify(token);d.sessionReasons={[user.id]:'password_reset'};
      addAccountEvent(d,accountEvent('password_reset_completed',{id:0,username:'Reset-link holder'},user,{source:'owner_reset_link',requestedBy:token.requested_by}));
      return {user_id:user.id};
    });
  },
};}
