# singstar-karaoke-room (Cloudflare Worker)

Kleiner Cloudflare Worker mit einer Durable Object pro Session, die eine
gemeinsame Warteliste (und optional einen geteilten YouTube-API-Key) über
mehrere Geräte hinweg synchron hält – z.B. Host-Laptop + Gäste-Handys.

Läuft komplett getrennt vom eigentlichen (statischen) Frontend auf GitHub
Pages; das Frontend spricht den Worker nur per `fetch()` an.

## API

- `POST /api/rooms` → `{ code }` – neue Session anlegen (6-stelliger Code)
- `GET /api/rooms/:code/queue` → `{ queue, apiKey }`
- `POST /api/rooms/:code/queue` mit `{ videoId, title?, addedBy? }` → fügt einen Song hinzu, gibt aktualisierte Liste zurück
- `DELETE /api/rooms/:code/queue/:itemId` → entfernt einen Song
- `POST /api/rooms/:code/apikey` mit `{ apiKey }` → setzt den für diese Session geteilten YouTube-API-Key

Kein Auth außer dem Code selbst (bewusst simpel gehalten, wie ein
Party-Spiel-Code). `queue` ist auf 100 Einträge begrenzt.

## Deployment

```bash
npm install
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

Der Account wird über `account_id` in `wrangler.toml` festgelegt. Durable
Objects laufen hier als **SQLite-backed** Klasse (`new_sqlite_classes` in der
Migration) – das ist die Variante, die auch auf dem kostenlosen Workers-Plan
läuft, nicht nur auf dem Paid-Plan.

## Kosten

Für eine private Party-App bleibt das mit hoher Wahrscheinlichkeit im
kostenlosen Kontingent von Cloudflare. Aktuelle Limits im
[Cloudflare-Dashboard](https://dash.cloudflare.com/) prüfen, falls sich das
mal ändert.

## Bekannte Einschränkungen

- Sessions laufen nicht automatisch ab / werden nicht automatisch gelöscht.
- Kein Rate-Limiting – für den privaten Gebrauch unter Freunden unkritisch,
  für öffentlichen Einsatz ggf. nachrüsten.
- `apiKey` liegt unverschlüsselt in der Durable-Object-Storage. Empfehlung:
  den YouTube-API-Key in der Google Cloud Console per HTTP-Referrer auf die
  eigene Domain einschränken (siehe Haupt-README bzw. Hilfe-Dialog der App).
