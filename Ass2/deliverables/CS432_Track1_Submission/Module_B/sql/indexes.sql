-- Optional script to re-apply indexing strategy explicitly during benchmarking.
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_members_group_email ON members(group_name, email);
CREATE INDEX IF NOT EXISTS idx_sessions_active_expiry ON sessions(active, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_portfolios_updated_at ON portfolios(updated_at);
