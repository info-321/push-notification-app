// Push setup is independent of the legacy domain-ownership verification status.
// Existing browser subscriptions provide installation evidence without a backfill.
export const selectPublicDomains = `SELECT
  d.id, d.user_id, d.domain_name, COALESCE(NULLIF(d.display_name, ''), d.domain_name) AS display_name, d.domain_key, d.status,
  d.vapid_public_key, d.created_at, d.updated_at,
  (COALESCE(d.vapid_public_key, '') <> ''
    AND COALESCE(d.vapid_private_key, '') <> ''
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.domain_key = d.domain_key AND s.user_id = d.user_id
        AND COALESCE(s.p256dh, '') <> '' AND COALESCE(s.auth, '') <> ''
    )) AS is_configured
FROM domains d`;

export const publicDomain = row => ({
  ...row,
  is_configured: Number(row.is_configured) === 1,
});
