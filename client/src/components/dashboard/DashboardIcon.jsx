import React from 'react';

export default function Icon({ name, ...props }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v11H3Z" /><path d="M9 21v-8h6v8" /></>,
    send: <><path d="m21 3-7 18-4-7-7-4Z" /><path d="m10 14 5-5" /></>,
    template: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M8 21h13V8M7 10h6m-3-3v6" /></>,
    report: <><path d="M6 3h12v18H6Z" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
    bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4" /><path d="M12 2v2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
    popup: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18m-13 6h8" /></>,
    exit: <><path d="M14 3h6v18h-6M3 12h12m-7-5-5 5 5 5" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.report}</svg>;
}

