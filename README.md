# test-cloudflare

Cloudflare Worker + Telegram Bot für Immobilienanzeigen in Düsseldorf mit D1 als Persistenz.

## Voraussetzungen

- Node.js 20+
- Wrangler CLI
- Cloudflare D1 Datenbank

## Konfiguration

### `wrangler.jsonc`

- `DB` ist das D1-Binding.
- `APP_ENV` steuert das Laufzeitverhalten (`development`/`production`).
- `UPDATE_RETENTION_DAYS` steuert die Aufbewahrung verarbeiteter Telegram-Updates.
- `env.production` muss mit echter Produktions-DB-ID gepflegt werden.

### Pflicht-Secrets

Setze die Secrets pro Umgebung:

- `TELEGRAM_BOT_TOKEN` (bevorzugt)
- `TELEGRAM_BOT_TOK` (Legacy-Fallback, optional)
- `TELEGRAM_WEBHOOK_SECRET` (in Produktion verpflichtend)

Beispiel:

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

## Datenbank-Migrationen (D1)

Migrationen liegen unter:

- `migrations/0001_initial.sql`
- `migrations/0002_cleanup_legacy_tables.sql`

Empfohlene Ausführung:

```bash
wrangler d1 migrations apply <DB_NAME>
```

Wenn ihr nicht mit Wrangler-Migrationsmetadaten arbeitet, die SQL-Dateien in Reihenfolge mit `wrangler d1 execute` ausführen.

## Lokaler Start

```bash
wrangler dev
```

Webhook-Endpunkt:

- `POST /telegram/webhook`

Health-Endpunkt:

- `GET /`

## Deployment

Development:

```bash
wrangler deploy
```

Production:

```bash
wrangler deploy --env production
```

## Betriebs-Runbook (kurz)

- Bei `500 Worker misconfigured` zuerst Secrets und `APP_ENV` prüfen.
- Bei DB-Fehlern sicherstellen, dass Migrationen vollständig angewendet wurden.
- `telegram_updates` wird automatisch gemäß `UPDATE_RETENTION_DAYS` bereinigt.