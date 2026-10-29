// Approximate browser device categories, not hardware identification. Store only
// the category, never the raw User-Agent. Tablets count as mobile web browsers.
export function requestDevice(req) {
  const agent = req.get('User-Agent');
  if (typeof agent !== 'string' || agent.length > 2048 || /bot|spider|crawler|curl|wget|undici|python-requests/i.test(agent)) return null;
  if (req.get('Sec-CH-UA-Mobile') === '?1' || /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk\/|Kindle|Windows Phone/i.test(agent)) return 'mobile';
  if (/Windows NT|Macintosh|X11|CrOS|Linux (?:x86_64|i686)/i.test(agent)) return 'desktop';
  return null;
}

export const browserFamilies = ['Chrome', 'Firefox', 'Edge', 'Safari', 'Opera', 'Samsung Internet', 'Brave', 'Other'];

// Test derivative browsers before Chrome/Safari compatibility tokens. Only a
// family is retained; versions and the original identifying headers are not.
export function requestBrowser(req) {
  const agent = req.get('User-Agent');
  if (typeof agent !== 'string' || !agent || agent.length > 2048 || /bot|spider|crawler|curl|wget|undici|python-requests/i.test(agent)) return null;
  const brands = req.get('Sec-CH-UA') || '';
  if (/Edg(?:e|A|iOS)?\//i.test(agent) || /"Microsoft Edge"\s*;/i.test(brands)) return 'Edge';
  if (/(?:OPR|OPiOS|Opera)\//i.test(agent) || /"Opera"\s*;/i.test(brands)) return 'Opera';
  if (/SamsungBrowser\//i.test(agent)) return 'Samsung Internet';
  if (/Brave\//i.test(agent) || /"Brave"\s*;/i.test(brands)) return 'Brave';
  if (/(?:Vivaldi|YaBrowser|UCBrowser|DuckDuckGo)\//i.test(agent)) return 'Other';
  if (/(?:Firefox|FxiOS)\//i.test(agent)) return 'Firefox';
  if (/(?:Chrome|CriOS|Chromium)\//i.test(agent)) return 'Chrome';
  if (/Version\//i.test(agent) && /Safari\//i.test(agent)) return 'Safari';
  return null;
}

export const deviceCountSql = `SUM(CASE WHEN device_type = 'desktop' THEN 1 ELSE 0 END) AS desktop,
  SUM(CASE WHEN device_type = 'mobile' THEN 1 ELSE 0 END) AS mobile`;

export function summarizeDevices(row) {
  const total = Number(row.subscribers || 0), desktop = Number(row.desktop || 0), mobile = Number(row.mobile || 0);
  const recorded = desktop + mobile, available = recorded > 0 || total === 0;
  return { desktop: available ? desktop : null, mobile: available ? mobile : null,
    device_unknown: total - recorded, device_recorded: recorded, device_available: available };
}
