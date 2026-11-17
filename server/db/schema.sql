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

-- Subscriptions table to store push endpoints per domain/user.
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  domain_key VARCHAR(128) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NULL,
  auth TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_endpoint (endpoint(255))
);

-- Dashboard recovery data is separate from domain/subscriber data.
CREATE TABLE IF NOT EXISTS account_recovery (
 user_id BIGINT UNSIGNED PRIMARY KEY, verified_email VARCHAR(254) NULL,
 verified_ms BIGINT NULL, pending_email VARCHAR(254) NULL
);
CREATE TABLE IF NOT EXISTS account_recovery_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
 purpose VARCHAR(12) NOT NULL, email VARCHAR(254) NOT NULL, session_version VARCHAR(64) NOT NULL,
 created_ms BIGINT NOT NULL, expires_ms BIGINT NOT NULL, used_ms BIGINT NULL,
 KEY recovery_user(user_id,purpose), KEY recovery_expiry(expires_ms)
);
CREATE TABLE IF NOT EXISTS account_recovery_limits (
 key_hash CHAR(64) PRIMARY KEY, start_ms BIGINT NOT NULL, attempts INT NOT NULL,
 KEY recovery_limit_expiry(start_ms)
);
