import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/movies.js', ['movies.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
export const genres = {
  'action-adventure': 'Action & adventure', animation: 'Animation', classic: 'Classics',
  comedy: 'Comedy', drama: 'Drama', family: 'Family', horror: 'Horror',
  mystery: 'Mystery', 'scifi-fantasy': 'Sci-fi & fantasy', western: 'Western',
};

export function createAppServer(fetchApi = fetch) {
  let cached;
  let pending;
  async function loadCatalog() {
    if (cached && Date.now() - cached.savedAt < 900000) return cached.payload;
    if (pending) return pending;
    pending = (async () => {
      const results = await Promise.allSettled(Object.entries(genres).map(async ([slug, label]) => {
        const response = await fetchApi(`https://api.sampleapis.com/movies/${slug}`, {
          signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Catalog request failed');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Unexpected catalog response');
        return data.filter(movie => movie && typeof movie.title === 'string' && movie.title.trim())
          .map(movie => ({
            title: movie.title.trim(),
            imdbId: /^tt\d+$/.test(String(movie.imdbId)) ? movie.imdbId : null,
            poster: typeof movie.posterURL === 'string' && movie.posterURL.startsWith('https://') ? movie.posterURL : null,
            genres: [label],
          }));
      }));
      const successful = results.filter(result => result.status === 'fulfilled');
      if (!successful.length) throw new Error('Movie catalog unavailable');
      const unique = new Map();
      for (const movie of successful.flatMap(result => result.value)) {
        const key = movie.imdbId || movie.title.toLocaleLowerCase();
        const existing = unique.get(key);
        if (existing) {
          existing.genres = [...new Set([...existing.genres, ...movie.genres])];
          existing.poster ||= movie.poster;
        } else unique.set(key, movie);
      }
      const payload = {
        movies: [...unique.values()].sort((a, b) => a.title.localeCompare(b.title)),
        fetchedAt: new Date().toISOString(),
        warning: successful.length < results.length ? 'Some genres could not be loaded. You can still search the available films; try Reload catalog shortly.' : null,
      };
      // Partial catalogs get a shorter cache so temporary failures can recover.
      cached = { payload, savedAt: Date.now() - (payload.warning ? 840000 : 0) };
      return payload;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(body);
    };
    try {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return send(405, JSON.stringify({ error: 'Method not allowed.' }));
      }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/movies') {
        try { return send(200, JSON.stringify(await loadCatalog())); }
        catch { return send(502, JSON.stringify({ error: 'The movie catalog is unavailable. Check your connection and try again.' })); }
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
  createAppServer().listen(port, host, () => console.log(`Reel is running at http://${host}:${port}`));
}
