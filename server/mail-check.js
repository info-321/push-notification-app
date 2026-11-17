// Run inside the configured API container. Verifies SMTP only; sends no email.
import {createRecoveryMailer} from './mail.js';
try {
  const mail=createRecoveryMailer();
  if(!mail.enabled){console.log('Email delivery is disabled. Configure SMTP and set MAIL_ENABLED=true first.');process.exitCode=1;}
  else {await mail.verify();console.log('SMTP connection, TLS and authentication verified. No email was sent.');}
}catch{console.error('SMTP verification failed. Check the provider settings, credentials and outbound SMTP access.');process.exitCode=1;}
