# test-cloudflare

Cloudflare Worker für einen Telegram-Bot mit D1-Backend.

## Voraussetzungen

- Cloudflare Worker + D1 Binding `DB`
- Telegram Bot Token als Secret

## Sicherheitsrelevante Variablen

Pflicht:
- `TELEGRAM_BOT_TOKEN` (Fallback: `TELEGRAM_BOT_TOK` für Altbestand)

Empfohlen:
- `TELEGRAM_WEBHOOK_SECRET` (immer setzen)

Zusätzlich:
- `APP_ENV=production` erzwingt das Vorhandensein von `TELEGRAM_WEBHOOK_SECRET`.

## D1-Strategie für bestehende Datenbank

Wichtig:
- Keine destruktiven SQL-Operationen (`DROP`, `DELETE` ohne Filter, `RESET`).
- Keine automatische Annahme einer leeren Datenbank.
- Die vorhandene Remote-D1-Struktur ist maßgeblich.

Im Worker wird beim Request-Start geprüft, ob alle benötigten Tabellen/Spalten existieren.  
Bei Abweichungen antwortet der Worker mit `500 Server misconfigured`, statt Daten zu überschreiben.

## Migrationen im Repository

- Migrationen liegen unter `migrations/`.
- `migrations/0001_baseline_non_destructive.sql` enthält nur nicht-destruktive `CREATE TABLE IF NOT EXISTS` und `CREATE INDEX IF NOT EXISTS`.

Hinweis: Das Vorhandensein der Migrationsdatei führt **nicht** automatisch eine Remote-Migration aus.

## Deployment

1. Secrets setzen:
   - `wrangler secret put TELEGRAM_BOT_TOKEN`
   - `wrangler secret put TELEGRAM_WEBHOOK_SECRET`
2. Konfiguration in `wrangler.jsonc` prüfen (D1 `database_id`, `migrations_dir`).
3. Deploy:
   - `wrangler deploy`

## Telegram-Idempotenz und Retry

- Updates werden über `telegram_updates.update_id` dedupliziert.
- Nur das erste Eintreffen einer `update_id` wird verarbeitet.
- Telegram-API-Aufrufe haben kontrollierte Retries (transiente HTTP-Fehler + Netzfehler).
- Bei retrybaren Verarbeitungsfehlern wird die reservierte `update_id` freigegeben, damit Telegram erneut zustellen kann.

## Lokale Konsistenzprüfung

- JavaScript-Syntax prüfen:
  - `node --check src/index.js`