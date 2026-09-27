// Durable Object holding one karaoke session's shared queue, an optional
// shared YouTube Data API key, and WebRTC signaling state for up to 4
// "phone as wireless mic" slots. Signaling is plain HTTP polling (no
// WebSocket) — connection setup takes a couple of seconds, but the actual
// audio, once connected, flows directly between the phone and the host over
// WebRTC (P2P/STUN), not through this Worker at all.
const MIC_SLOTS = ['1', '2', '3', '4'];
const MAX_ICE_CANDIDATES = 60;

function emptyMic() {
  return { taken: false, offer: null, label: '', answer: null, iceFromPhone: [], iceFromHost: [] };
}

function emptyMics() {
  const mics = {};
  MIC_SLOTS.forEach((s) => { mics[s] = emptyMic(); });
  return mics;
}

export class Room {
  constructor(state) {
    this.state = state;
    this.queue = null;
    this.apiKey = null;
    this.mics = null;
  }

  async load() {
    if (this.queue === null) {
      this.queue = (await this.state.storage.get('queue')) || [];
    }
    if (this.apiKey === null) {
      this.apiKey = (await this.state.storage.get('apiKey')) || '';
    }
    if (this.mics === null) {
      this.mics = (await this.state.storage.get('mics')) || emptyMics();
    }
  }

  async persistQueue() {
    await this.state.storage.put('queue', this.queue);
  }

  async persistMics() {
    await this.state.storage.put('mics', this.mics);
  }

  micsPublicView() {
    const out = {};
    for (const slot of MIC_SLOTS) {
      const m = this.mics[slot];
      out[slot] = { taken: m.taken, label: m.label, offer: m.offer, iceFromPhone: m.iceFromPhone };
    }
    return out;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/queue' && request.method === 'GET') {
      return Response.json({ queue: this.queue, apiKey: this.apiKey });
    }

    if (path === '/queue' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
      }
      const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
      if (!/^[\w-]{11}$/.test(videoId)) {
        return Response.json({ error: 'Ungültige Video-ID' }, { status: 400 });
      }
      if (this.queue.length >= 100) {
        return Response.json({ error: 'Warteliste ist voll (max. 100)' }, { status: 400 });
      }
      const item = {
        id: crypto.randomUUID(),
        videoId,
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : '',
        addedBy: typeof body.addedBy === 'string' ? body.addedBy.slice(0, 40) : '',
        addedAt: Date.now(),
      };
      this.queue.push(item);
      await this.persistQueue();
      return Response.json({ queue: this.queue, apiKey: this.apiKey }, { status: 201 });
    }

    const removeMatch = path.match(/^\/queue\/([^/]+)$/);
    if (removeMatch && request.method === 'DELETE') {
      const itemId = removeMatch[1];
      const before = this.queue.length;
      this.queue = this.queue.filter((it) => it.id !== itemId);
      if (this.queue.length !== before) await this.persistQueue();
      return Response.json({ queue: this.queue, apiKey: this.apiKey });
    }

    if (path === '/apikey' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
      }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim().slice(0, 200) : '';
      this.apiKey = apiKey;
      await this.state.storage.put('apiKey', this.apiKey);
      return Response.json({ queue: this.queue, apiKey: this.apiKey });
    }

    // --- Mic signaling (WebRTC offer/answer/ICE relay) ---

    if (path === '/mics' && request.method === 'GET') {
      return Response.json({ mics: this.micsPublicView() });
    }

    if (path === '/mics/join' && request.method === 'POST') {
      const free = MIC_SLOTS.find((s) => !this.mics[s].taken);
      if (!free) {
        return Response.json({ error: 'Alle 4 Mikrofon-Plätze sind belegt.' }, { status: 409 });
      }
      this.mics[free] = emptyMic();
      this.mics[free].taken = true;
      await this.persistMics();
      return Response.json({ slot: free });
    }

    const slotMatch = path.match(/^\/mics\/([1-4])\/([a-z-]+)$/);
    if (slotMatch) {
      const slot = slotMatch[1];
      const action = slotMatch[2];
      const mic = this.mics[slot];

      if (action === 'offer' && request.method === 'POST') {
        if (!mic.taken) return Response.json({ error: 'Platz nicht reserviert' }, { status: 409 });
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
        }
        mic.offer = typeof body.sdp === 'string' ? body.sdp : null;
        mic.label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : `Mikro ${slot}`;
        mic.answer = null;
        mic.iceFromHost = [];
        await this.persistMics();
        return Response.json({ ok: true });
      }

      if (action === 'status' && request.method === 'GET') {
        return Response.json({ taken: mic.taken, answer: mic.answer, iceFromHost: mic.iceFromHost });
      }

      if (action === 'ice-from-phone' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
        }
        if (body.candidate && mic.iceFromPhone.length < MAX_ICE_CANDIDATES) mic.iceFromPhone.push(body.candidate);
        await this.persistMics();
        return Response.json({ ok: true });
      }

      if (action === 'ice-from-host' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
        }
        if (body.candidate && mic.iceFromHost.length < MAX_ICE_CANDIDATES) mic.iceFromHost.push(body.candidate);
        await this.persistMics();
        return Response.json({ ok: true });
      }

      if (action === 'answer' && request.method === 'POST') {
        if (!mic.taken) return Response.json({ error: 'Platz nicht reserviert' }, { status: 409 });
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return Response.json({ error: 'Ungültiger Body' }, { status: 400 });
        }
        mic.answer = typeof body.sdp === 'string' ? body.sdp : null;
        await this.persistMics();
        return Response.json({ ok: true });
      }

      if (action === 'leave' && request.method === 'POST') {
        this.mics[slot] = emptyMic();
        await this.persistMics();
        return Response.json({ ok: true });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
