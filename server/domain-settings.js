export const defaultTimeZone = 'Asia/Kolkata';

export function validTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch { return false; }
}

export function installDomainSettings(app, pool) {
  app.get('/api/domains/:key/settings', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [rows] = await pool.query('SELECT domain_key, domain_name, time_zone FROM domains WHERE domain_key = ? AND user_id = ?', [req.params.key, 1]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      return res.json({ ok: true, data: { ...rows[0], time_zone: rows[0].time_zone || defaultTimeZone } });
    } catch (error) {
      console.error('Could not read domain settings:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load settings.' });
    }
  });

  app.put('/api/domains/:key/settings', async (req, res) => {
    const timeZone = req.body?.time_zone;
    if (!validTimeZone(timeZone)) return res.status(400).json({ ok: false, message: 'Choose a valid time zone.' });
    try {
      const [result] = await pool.query('UPDATE domains SET time_zone = ? WHERE domain_key = ? AND user_id = ?', [timeZone, req.params.key, 1]);
      if (!result.affectedRows) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      return res.json({ ok: true, data: { domain_key: req.params.key, time_zone: timeZone } });
    } catch (error) {
      console.error('Could not save domain settings:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not save settings. Please try again.' });
    }
  });
}
