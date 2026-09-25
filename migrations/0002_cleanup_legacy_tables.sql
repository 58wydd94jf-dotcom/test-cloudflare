PRAGMA foreign_keys = ON;

-- Optional: remove stale rows older than retention baseline during migration rollout.
DELETE FROM telegram_updates
WHERE created_at < datetime('now', '-90 days');
