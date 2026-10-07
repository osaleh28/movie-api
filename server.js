import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWikidata, validId } from './wikidata.js';
import { findConnection } from './connections.js';
import { createGame } from './game.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/connections-ui.js', ['connections-ui.js', 'text/javascript; charset=utf-8']],
  ['/game-ui.js', ['game-ui.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
export function createAppServer(fetchApi = fetch) {
  const castData = createWikidata(fetchApi);
  const game = createGame(castData);
  return createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(body);
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/game' && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 4096) return send(413, JSON.stringify({ error: 'Request too large.' }));
        }
        let input;
        try { input = JSON.parse(body); } catch { return send(400, JSON.stringify({ error: 'Invalid JSON.' })); }
        if (!input || typeof input !== 'object') return send(400, JSON.stringify({ error: 'Invalid game request.' }));
        try {
          if (input.action === 'start') {
            if (!Number.isSafeInteger(input.index) || input.index < 0) return send(400, JSON.stringify({ error: 'Invalid round number.' }));
            return send(200, JSON.stringify(await game.start(input.index)));
          }
          return send(200, JSON.stringify(game.act(input.id, input.action, input.actorId)));
        } catch (error) { return send(input.action === 'start' ? 502 : 400, JSON.stringify({ error: error.message })); }
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return send(405, JSON.stringify({ error: 'Method not allowed.' }));
      }
      if (url.pathname === '/api/actors') {
        const name = (url.searchParams.get('name') || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80) return send(400, JSON.stringify({ error: 'Enter a name between 2 and 80 characters.' }));
        try { return send(200, JSON.stringify({ actors: await castData.actors(name) })); }
        catch (error) { return send(502, JSON.stringify({ error: error.message })); }
      }
      if (url.pathname === '/api/connections') {
        const fromId = url.searchParams.get('from'), toId = url.searchParams.get('to');
        if (!validId(fromId) || !validId(toId)) return send(400, JSON.stringify({ error: 'Choose both actors from the name suggestions.' }));
        const disconnect = new AbortController();
        response.on('close', () => disconnect.abort());
        const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(45000)]);
        try {
          const [from, to] = await castData.people([fromId, toId], signal);
          const result = await findConnection(from, to, castData.neighbors, { signal });
          if (result.status === 'found') {
            const actors = await castData.people(result.actors.map(actor => actor.id), signal);
            result.actors = actors;
          }
          if (!response.destroyed) return send(200, JSON.stringify(result));
        } catch (error) {
          if (!response.destroyed) return send(502, JSON.stringify({ error: signal.aborted ? 'The search took too long. Try again or choose another pair.' : error.message }));
        }
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) return send(404, JSON.stringify({ error: 'Page not found.' }));
      send(200, await readFile(new URL(`./public/${asset[0]}`, import.meta.url)), asset[1]);
    } catch { send(500, JSON.stringify({ error: 'Something went wrong.' })); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createAppServer().listen(port, host, () => console.log(`Reel Connections is running at http://${host}:${port}`));
}
