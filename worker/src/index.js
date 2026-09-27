export { Room } from './room.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(resp) {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

function json(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

// 32-symbol alphabet without 0/O/1/I/L to avoid ambiguous codes when read off
// a screen or typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'api' || parts[1] !== 'rooms') {
      return json({ error: 'Not found' }, 404);
    }

    // POST /api/rooms -> create a new room, no state touched yet (the
    // Durable Object initializes lazily on first real request).
    if (parts.length === 2 && request.method === 'POST') {
      return json({ code: generateCode() });
    }

    // /api/rooms/:code/... -> proxy straight through to that room's DO.
    if (parts.length >= 3) {
      const code = parts[2].toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) {
        return json({ error: 'Ungültiger Code' }, 400);
      }
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.pathname = '/' + parts.slice(3).join('/');
      const resp = await stub.fetch(doUrl.toString(), request);
      return withCors(resp);
    }

    return json({ error: 'Not found' }, 404);
  },
};
