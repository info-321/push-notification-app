// Approximate browser device categories, not hardware identification. Store only
// the category, never the raw User-Agent. Tablets count as mobile web browsers.
export function requestDevice(req) {
  const agent = req.get('User-Agent');
  if (typeof agent !== 'string' || agent.length > 2048 || /bot|spider|crawler|curl|wget|undici|python-requests/i.test(agent)) return null;
  if (req.get('Sec-CH-UA-Mobile') === '?1' || /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk\/|Kindle|Windows Phone/i.test(agent)) return 'mobile';
  if (/Windows NT|Macintosh|X11|CrOS|Linux (?:x86_64|i686)/i.test(agent)) return 'desktop';
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
