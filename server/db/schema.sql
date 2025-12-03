-- Domains table for MySQL
-- Prevent duplicates with unique constraints; track verification status, VAPID keys, and domain key.

CREATE TABLE IF NOT EXISTS domains (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  domain_name VARCHAR(255) NOT NULL,
  domain_key VARCHAR(64) NOT NULL,
  status ENUM('pending', 'verified', 'failed') NOT NULL DEFAULT 'pending',
  verification_token VARCHAR(128) NOT NULL,
  vapid_public_key TEXT NULL,
  vapid_private_key TEXT NULL,
  last_check_result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_domain (user_id, domain_name),
  UNIQUE KEY uniq_domain_key (domain_key),
  KEY idx_status (status)
);
