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

### Mikrofon-Signalisierung (WebRTC offer/answer/ICE relay für "Handy als Mikro")

Reines HTTP-Polling, kein WebSocket. Der eigentliche Audio-Stream läuft nach
dem Verbindungsaufbau direkt zwischen den Geräten (P2P/STUN), nicht über
diesen Worker.

- `GET /api/rooms/:code/mics` → `{ mics: { "1": {...}, "2": {...}, "3": {...}, "4": {...} } }` (Host pollt das)
- `POST /api/rooms/:code/mics/join` → reserviert den ersten freien der 4 Plätze, `{ slot }` oder 409 wenn alle belegt
- `POST /api/rooms/:code/mics/:slot/offer` mit `{ sdp, label? }` (Handy postet sein Offer)
- `GET /api/rooms/:code/mics/:slot/status` → `{ taken, answer, iceFromHost }` (Handy pollt das)
- `POST /api/rooms/:code/mics/:slot/ice-from-phone` / `.../ice-from-host` mit `{ candidate }`
- `POST /api/rooms/:code/mics/:slot/answer` mit `{ sdp }` (Host postet seine Antwort)
- `POST /api/rooms/:code/mics/:slot/leave` → gibt den Platz wieder frei (von beiden Seiten aufrufbar)

Kein Auth außer dem Code selbst (bewusst simpel gehalten, wie ein
Party-Spiel-Code). `queue` ist auf 100 Einträge begrenzt, ICE-Kandidaten-
Arrays pro Mikro-Platz auf 60.

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
