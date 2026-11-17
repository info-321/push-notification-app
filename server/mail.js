import nodemailer from 'nodemailer';
export const validMailbox=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9_+%.-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)&&!value.startsWith('.')&&!value.includes('..')&&!value.includes('.@');
export function createRecoveryMailer(env=process.env) {
  if(env.MAIL_ENABLED!=='true')return {enabled:false};
  const port=Number(env.SMTP_PORT||587);
  if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD||!validMailbox(env.SMTP_FROM)||![465,587].includes(port))throw new Error('Configure SMTP_HOST, SMTP_PORT (465/587), SMTP_USER, SMTP_PASSWORD and SMTP_FROM before enabling mail.');
  const transport=nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port===465,requireTLS:port===587,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
    connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  return {enabled:true,verify:()=>transport.verify(),
    async send({to,purpose,url}){
      const verify=purpose==='verify';
      if(!validMailbox(to))throw new Error('Invalid recipient.');
      const result=await transport.sendMail({from:{name:'Notizo',address:env.SMTP_FROM},to:{address:to},
        subject:verify?'Verify your Notizo recovery email':'Reset your Notizo password',
        text:`${verify?'Confirm this email address for your Notizo account':'Choose a new Notizo password'}:\n\n${url}\n\nThis link expires in ${verify?'30':'15'} minutes and can be used once. If you did not request this, ignore this email. Never share this link.`,
        headers:{'Auto-Submitted':'auto-generated'}});
      if(!result.accepted?.length)throw new Error('Email was not accepted.');
    },
  };
}
