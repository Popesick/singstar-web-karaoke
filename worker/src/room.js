// Durable Object holding one karaoke session's shared queue and (optionally)
// a YouTube Data API key, so every device that joins via the room code can
// search without needing its own key.
export class Room {
  constructor(state) {
    this.state = state;
    this.queue = null;
    this.apiKey = null;
  }

  async load() {
    if (this.queue === null) {
      this.queue = (await this.state.storage.get('queue')) || [];
    }
    if (this.apiKey === null) {
      this.apiKey = (await this.state.storage.get('apiKey')) || '';
    }
  }

  async persistQueue() {
    await this.state.storage.put('queue', this.queue);
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

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
