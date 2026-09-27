# SingStar Web Karaoke

Ein browserbasiertes Karaoke-Spiel: YouTube-Video als Bühne, Mikrofone werden
per Web Audio API dazugemischt. Video- und Mikrofon-Ton lassen sich getrennt
regeln und per Delay/Sync-Offset aufeinander abstimmen. Läuft komplett
client-seitig, kein Server/Backend nötig.

**[Live-Demo (GitHub Pages)](https://popesick.github.io/singstar-web-karaoke/)**

## Features

- YouTube-Video per Link oder Video-ID laden, Play/Pause/Neustart, einfache Warteliste für den nächsten Song
- **Karaoke-Suche** direkt in der App über die offizielle YouTube Data API v3 (eigener, kostenloser API-Key
  nötig) – zeigt dank `videoEmbeddable`/`videoSyndicated`-Filter von vornherein nur Videos, die sich auch
  wirklich einbetten und abspielen lassen
- **Alternativ: lokale Videodatei** (MP4/WebM/…) direkt abspielen – nützlich, wenn ein YouTube-Video das
  Einbetten nicht erlaubt, oder für eigene Karaoke-Videos. Der Ton läuft dabei sogar echt über die
  Web-Audio-Engine (keine Cross-Origin-Einschränkung wie bei YouTube)
- Getrennte Lautstärkeregler für Video-Ton (YouTube-Player bzw. Web-Audio-Gain bei lokaler Datei) und Mikrofone (Web-Audio-Mixer)
- Zwei unabhängige Mikrofon-Kanäle mit je eigener Lautstärke, Delay (0–500 ms) und Stumm-Schalter, inkl. VU-Meter
- **Stereo-Splitting**: Ein 2-kanaliges USB-Mikrofon (z.B. das originale SingStar-USB-Dongle für PS2)
  wird automatisch in Mikro 1 (links) und Mikro 2 (rechts) aufgeteilt
- **Sync-Offset** für das Video (±500 ms), um Bild/Ton bei spürbarer Latenz in der Mikrofonkette
  wieder in Einklang zu bringen
- Einstellungen (Lautstärken, Delays, gewähltes Gerät) werden im Browser (localStorage) gemerkt
- Bühnenmodus/Vollbild für die Party (per "Menü"-Button jederzeit zurück zur normalen Ansicht)
- Mixer (Video-/Mikrofon-Regler) und YouTube-API-Key sind in einem eigenen "⚙ Einstellungen"-Dialog
  gebündelt; die rechte Spalte zeigt stattdessen Warteliste, Suche und die gemeinsame Session
- **Gemeinsame Session**: Über einen kleinen Cloudflare Worker (Durable Object pro Session) lässt sich eine
  geteilte Warteliste öffnen – andere Geräte (z.B. Gäste-Handys) scannen einen QR-Code, öffnen einen Link
  oder geben den Code ein und können Songs zur selben Warteliste hinzufügen, inklusive automatisch geteiltem
  YouTube-API-Key. Ein Gerät, das über den
  Link beitritt, bekommt automatisch eine schlanke Mobile-Ansicht ohne Player/Mixer, nur Suche + Warteliste
- **Handy als drahtloses Mikrofon**: Innerhalb einer Session per WebRTC (Browser-zu-Browser-Audio in
  Echtzeit, ~20–60 ms Latenz, `playoutDelayHint`/`latencyHint: 'interactive'` für minimale Pufferung) den Ton
  eines Geräts direkt zur Hauptsession übertragen und über den Video-Sound legen – bis zu 4 Geräte
  gleichzeitig, jedes mit eigener Lautstärke/Delay/Stumm/VU-Meter unter Einstellungen → Externe Mikrofone.
  Eigenes Pegel-Meter + leuchtendes Mikro-Symbol auf dem sendenden Gerät zur Fehlersuche ("kommt überhaupt Ton
  am Mikro an?"). Gegen akustische Rückkopplung (Handy-Mikro hört die Lautsprecher der Hauptsession):
  niedrigerer Standard-Pegel (70%) plus ein Begrenzer (Limiter) pro Handy-Mikro-Kanal

## Nutzung

1. Repository klonen oder als ZIP herunterladen.
2. Da Mikrofonzugriff (`getUserMedia`) und die YouTube-IFrame-API einen sicheren Kontext
   benötigen, die Datei **nicht direkt per `file://` öffnen**, sondern über einen lokalen
   Webserver oder GitHub Pages bereitstellen, z.B.:

   ```bash
   cd singstar-karaoke
   python3 -m http.server 8080
   ```

   Danach `http://localhost:8080` im Browser öffnen.

3. YouTube-Link oder Video-ID einfügen → **Laden**.
4. **Mikros aktivieren** klicken, Mikrofonzugriff erlauben, passendes USB-Gerät auswählen.
5. Lautstärken für Video und Mikrofon(e) einstellen. Falls Bild/Ton bzw. Gesang nicht
   synchron wirken, **Sync-Offset** und/oder **Mikro-Delay** in kleinen Schritten anpassen.

## Original SingStar-USB-Mikrofone (PS2)

Die originalen SingStar-Mikrofone für die PS2 werden über den mitgelieferten
**USB-Funkempfänger (Dongle)** angeschlossen. Dieser ist klassenkonform (USB Audio
Class) und wird von aktuellen Betriebssystemen ohne Zusatztreiber als normales
Mikrofon-Eingabegerät erkannt – üblicherweise als ein 2-kanaliges Stereo-Gerät,
bei dem **Mikrofon 1 auf dem linken und Mikrofon 2 auf dem rechten Kanal** liegt.

- Dongle einstecken, in den Betriebssystem-Soundeinstellungen den Gerätenamen notieren.
- In der App unter **Audiogerät** genau dieses Gerät auswählen.
- **Stereo-Splitting** aktiviert lassen – die App trennt L/R automatisch in Mikro 1/2.
- Sollte ein Kanal sehr leise sein, den jeweiligen Lautstärkeregler über 100 % anheben.

Ausführliche Hinweise gibt es auch direkt in der App über den **Hilfe**-Button.

## Technische Grenzen

- Der Ton eines eingebetteten YouTube-Videos kann aus Cross-Origin-Gründen nicht in die
  Web-Audio-Engine eingespeist werden. Video-Lautstärke wird daher über die YouTube-Player-API
  geregelt, Mikrofon-Lautstärke über den Web-Audio-Mixer – beide unabhängig, aber gleichzeitig nutzbar.
- Der Sync-Ausgleich funktioniert in zwei Richtungen: Das Video wird per Zeit-Offset
  nachjustiert (`videoOffset`), das Mikrofonsignal kann zusätzlich per Delay-Node verzögert werden.
- Bei Wiedergabe über Lautsprecher (statt Kopfhörer) kann es zu Rückkopplungen kommen.
  Für beste Ergebnisse Kopfhörer für Sänger:innen verwenden.

## Projektstruktur

```
singstar-karaoke/
├── index.html      Aufbau der Seite (Video-Panel, Playlist/Suche/Session, Einstellungen- & Hilfe-Dialog)
├── style.css       Dark-Stage-Theme
├── app.js          YouTube-Player, Web-Audio-Mixer, Sync-Logik, Persistenz, Session-Sync
├── assets/         Logo/Grafiken
└── worker/         Cloudflare Worker (Durable Object) für die geteilte Session, siehe worker/README.md
```

Frontend: Kein Build-Schritt, keine Abhängigkeiten außer der YouTube-IFrame-API (wird per
`<script>`-Tag von YouTube geladen). Der Worker im `worker/`-Verzeichnis ist ein separates,
eigenständig deploybares Projekt (Details dort).

## GitHub Pages aktivieren

Im Repository unter **Settings → Pages** als Quelle den `main`-Branch (Root) auswählen.
Die Seite ist danach unter `https://<user>.github.io/<repo>/` erreichbar (HTTPS,
somit funktioniert auch der Mikrofonzugriff).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
