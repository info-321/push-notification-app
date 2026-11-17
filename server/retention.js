import crypto from 'node:crypto';

const day = 86400000;
export function retentionPolicy(input = {}) {
  const result = { days: 90, auditDays: 365, batch: 500, maxBatches: 20, ...input };
  for (const [key, min, max] of [['days',90,3650],['auditDays',365,3650],['batch',1,1000],['maxBatches',1,100]]) {
    if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`Invalid retention policy: ${key}`);
  }
  if (Object.keys(result).some(key => !['days','auditDays','batch','maxBatches'].includes(key))) throw new Error('Unknown retention policy setting.');
  return result;
}

function operations(policy, now) {
  const cutoff = now - policy.days * day;
  return [
    { name:'subscriber_ips', table:'subscriptions', where:'ip_address IS NOT NULL AND COALESCE(ip_recorded_at,last_seen_at,created_at) < FROM_UNIXTIME(?)', params:[cutoff/1000], set:'ip_address=NULL,ip_recorded_at=NULL' },
    { name:'subscriber_coordinates', table:'subscriptions', where:'(latitude IS NOT NULL OR longitude IS NOT NULL) AND COALESCE(location_recorded_at,location_consent_at,created_at) < FROM_UNIXTIME(?)', params:[cutoff/1000], set:'latitude=NULL,longitude=NULL,location_accuracy_m=NULL,location_consent_at=NULL,location_recorded_at=NULL' },
    { name:'ended_sessions', table:'dashboard_sessions', where:'expires_ms < ? AND COALESCE(ended_ms,expires_ms) < ?', params:[cutoff,cutoff] },
    { name:'recovery_tokens', table:'account_recovery_tokens', where:'expires_ms < ?', params:[now-day] },
    { name:'recovery_limits', table:'account_recovery_limits', where:'start_ms < ?', params:[now-day] },
    { name:'login_attempts', table:'login_attempts', where:'occurred_ms < ?', params:[cutoff] },
    { name:'activity_history', table:'activity_log', where:'occurred_ms < ?', params:[now-policy.auditDays*day] },
    { name:'maintenance_history', table:'maintenance_runs', where:"status <> 'running' AND started_ms < ?", params:[now-policy.auditDays*day] },
  ];
}

async function archivePrompts(c, cutoff, policy) {
  let count = 0;
  for (let iteration=0; iteration<policy.maxBatches; iteration++) {
    await c.beginTransaction();
    try {
      const [rows] = await c.query(`SELECT domain_key,session_id,revision,template,device_group,
        FLOOR(UNIX_TIMESTAMP(created_at)/86400) AS day_number,
        CAST(UNIX_TIMESTAMP(created_at)*1000 AS UNSIGNED) AS first_ms,
        clicked_at IS NOT NULL AS clicks,dismissed_at IS NOT NULL AS dismissals,
        subscribed_at IS NOT NULL AS subscriptions
        FROM prompt_events WHERE created_at < FROM_UNIXTIME(?)
        ORDER BY created_at,domain_key,session_id LIMIT ? FOR UPDATE`, [cutoff/1000,policy.batch]);
      if (!rows.length) { await c.commit(); break; }
      const groups = new Map();
      for (const row of rows) {
        const key = JSON.stringify([row.domain_key,row.day_number,row.revision,row.template,row.device_group]);
        const group = groups.get(key) || { ...row,views:0,clicks:0,dismissals:0,subscriptions:0 };
        group.views++;group.clicks+=Number(row.clicks);group.dismissals+=Number(row.dismissals);group.subscriptions+=Number(row.subscriptions);
        group.first_ms=Math.min(Number(group.first_ms),Number(row.first_ms));groups.set(key,group);
      }
      for (const g of groups.values()) await c.query(`INSERT INTO prompt_daily_totals
        (domain_key,day_number,revision,template,device_group,views,clicks,dismissals,subscriptions,first_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
        views=views+VALUES(views),clicks=clicks+VALUES(clicks),dismissals=dismissals+VALUES(dismissals),
        subscriptions=subscriptions+VALUES(subscriptions),first_ms=LEAST(first_ms,VALUES(first_ms))`,
        [g.domain_key,g.day_number,g.revision,g.template,g.device_group,g.views,g.clicks,g.dismissals,g.subscriptions,g.first_ms]);
      for (const row of rows) await c.query('DELETE FROM prompt_events WHERE domain_key=? AND session_id=?',[row.domain_key,row.session_id]);
      await c.commit();count+=rows.length;
    } catch (error) { await c.rollback();throw error; }
  }
  return count;
}

async function archiveRecipients(c, cutoff, policy, now) {
  let count = 0;
  // Freeze totals once, then remove detail in bounded batches. A restart resumes
  // deletion without adding the totals a second time. Active sends are excluded.
  for (let iteration=0; iteration<policy.maxBatches; iteration++) {
    await c.beginTransaction();
    let campaign;
    try {
      const [rows] = await c.query(`SELECT id,archived_telemetry FROM push_campaigns c
        WHERE status <> 'sending' AND finished_ms < ?
        AND EXISTS (SELECT 1 FROM push_campaign_recipients r WHERE r.campaign_id=c.id)
        ORDER BY finished_ms,id LIMIT 1 FOR UPDATE`,[cutoff]);
      campaign=rows[0];
      if (!campaign) { await c.commit();break; }
      if (campaign.archived_telemetry === null) {
        const [[totals]] = await c.query(`SELECT COUNT(*) AS recipients,
          COALESCE(SUM(result='accepted'),0) AS recipient_accepted,
          COALESCE(SUM(acknowledged_ms IS NOT NULL),0) AS acknowledged,
          COALESCE(SUM(clicked_ms IS NOT NULL),0) AS clicks,
          COALESCE(SUM(clicked_ms IS NOT NULL AND result='accepted'),0) AS accepted_clicks
          FROM push_campaign_recipients WHERE campaign_id=?`,[campaign.id]);
        await c.query('UPDATE push_campaigns SET archived_telemetry=?,telemetry_archived_ms=? WHERE id=?',
          [JSON.stringify(Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,Number(value)]))),now,campaign.id]);
      }
      await c.commit();
    } catch(error) { await c.rollback();throw error; }
    const [deleted] = await c.query('DELETE FROM push_campaign_recipients WHERE campaign_id=? LIMIT ?',[campaign.id,policy.batch]);
    count+=deleted.affectedRows;
  }
  return count;
}

export async function runRetention(pool, { apply=false, policy:input, now=Date.now() } = {}) {
  const policy=retentionPolicy(input);
  if (typeof apply!=='boolean' || !Number.isSafeInteger(now)) throw new Error('Invalid retention run.');
  const c=await pool.getConnection(),id=crypto.randomUUID();let locked=false,recorded=false;
  const result={mode:apply?'apply':'preview',policy,eligible:{},changed:{}};
  try {
    const [[lock]]=await c.query("SELECT GET_LOCK('notizo_retention',0) AS acquired");
    if (Number(lock.acquired)!==1) throw new Error('Another retention run is in progress.');
    locked=true;
    for(const op of operations(policy,now))result.eligible[op.name]=Number((await c.query(`SELECT COUNT(*) AS n FROM ${op.table} WHERE ${op.where}`,op.params))[0][0].n);
    const cutoff=now-policy.days*day;
    result.eligible.prompt_events=Number((await c.query('SELECT COUNT(*) AS n FROM prompt_events WHERE created_at < FROM_UNIXTIME(?)',[cutoff/1000]))[0][0].n);
    result.eligible.campaign_recipients=Number((await c.query("SELECT COUNT(*) AS n FROM push_campaign_recipients r INNER JOIN push_campaigns c ON c.id=r.campaign_id WHERE c.status<>'sending' AND c.finished_ms<?",[cutoff]))[0][0].n);
    if (!apply)return result;
    await c.query("INSERT INTO maintenance_runs (id,started_ms,status,policy) VALUES (?,?,'running',?)",[id,now,JSON.stringify(policy)]);recorded=true;
    for(const op of operations(policy,now)){
      result.changed[op.name]=0;
      for(let iteration=0;iteration<policy.maxBatches;iteration++){
        const [changed]=await c.query(`${op.set?`UPDATE ${op.table} SET ${op.set}`:`DELETE FROM ${op.table}`} WHERE ${op.where} LIMIT ?`,[...op.params,policy.batch]);
        result.changed[op.name]+=changed.affectedRows;
        if(changed.affectedRows<policy.batch)break;
      }
    }
    result.changed.prompt_events=await archivePrompts(c,cutoff,policy);
    result.changed.campaign_recipients=await archiveRecipients(c,cutoff,policy,now);
    await c.query("UPDATE maintenance_runs SET status='completed',finished_ms=?,result=? WHERE id=?",[Date.now(),JSON.stringify(result),id]);
    return result;
  } catch(error) {
    if(recorded)await c.query("UPDATE maintenance_runs SET status='failed',finished_ms=?,result=? WHERE id=?",[Date.now(),JSON.stringify({changed:result.changed,error:'Retention failed; inspect the maintenance service.'}),id]).catch(()=>{});
    throw error;
  } finally {if(locked)await c.query("SELECT RELEASE_LOCK('notizo_retention')").catch(()=>{});c.release();}
}
