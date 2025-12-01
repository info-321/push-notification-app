-- Domains table for MySQL
-- Prevent duplicates with unique constraints; track verification status and checks.

CREATE TABLE IF NOT EXISTS domains (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id BIGINT UNSIGNED NOT NULL,
  domain VARCHAR(255) NOT NULL,
  status ENUM('pending', 'verified', 'failed') NOT NULL DEFAULT 'pending',
  verification_token VARCHAR(128) NOT NULL,
  last_check_result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_owner_domain (owner_id, domain),
  KEY idx_status (status)
);

-- Example index for global uniqueness (if you need it)
-- CREATE UNIQUE INDEX uniq_domain ON domains (domain);

-- Example insert
-- INSERT INTO domains (owner_id, domain, verification_token) VALUES (123, 'example.com', 'token-123');
