import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';
import { filterMovies, imdbUrl } from '../public/movies.js';

async function withServer(upstream, run) {
  const server = createAppServer(upstream);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('search combines title and genre, ignoring case, whitespace, and accents', () => {
  const movies = [{ title: 'Amélie', genres: ['Comedy'] }, { title: 'Batman', genres: ['Action & adventure'] }];
  assert.deepEqual(filterMovies(movies, '  AMELIE ', 'Comedy'), [movies[0]]);
  assert.deepEqual(filterMovies(movies, 'bat', 'Comedy'), []);
  assert.deepEqual(filterMovies(movies, ''), movies);
});

test('IMDb links require valid IDs', () => {
  assert.equal(imdbUrl('tt12345'), 'https://www.imdb.com/title/tt12345/');
  assert.equal(imdbUrl('javascript:alert(1)'), null);
  assert.equal(imdbUrl(null), null);
});

test('merges genre duplicates, sanitizes data, caches, and coalesces requests', async () => {
  let calls = 0;
  await withServer(async url => {
    calls++;
    assert.match(url, /^https:\/\/api\.sampleapis\.com\/movies\/[a-z-]+$/);
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json([
      { title: ' Batman ', imdbId: 'tt1234', posterURL: 'https://example.com/poster.jpg' },
      { title: 'No ID', imdbId: 'invalid', posterURL: 'javascript:alert(1)' },
      null, { title: '' }, { unrelated: true },
    ]);
  }, async base => {
    const [first, second] = await Promise.all([fetch(`${base}/api/movies`), fetch(`${base}/api/movies`)]);
    const data = await first.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(data.movies.length, 2);
    assert.equal(data.movies[0].title, 'Batman');
    assert.equal(data.movies[0].genres.length, 10);
    assert.equal(data.movies[1].poster, null);
    assert.equal(data.movies[1].imdbId, null);
    assert.equal(data.warning, null);
    await fetch(`${base}/api/movies`);
    assert.equal(calls, 10);
  });
});

test('partial genre failures return available movies and a warning', async () => {
  await withServer(async url => {
    if (url.endsWith('/animation')) return Response.json([{ title: 'Spirited Away', imdbId: 'tt0245429' }]);
    throw new Error('Unavailable');
  }, async base => {
    const response = await fetch(`${base}/api/movies`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.movies[0].title, 'Spirited Away');
    assert.match(data.warning, /Some genres/);
  });
});

test('empty catalogs succeed; failed or malformed upstream responses are retryable', async () => {
  await withServer(async () => Response.json([]), async base => {
    assert.deepEqual((await (await fetch(`${base}/api/movies`)).json()).movies, []);
  });
  for (const upstream of [
    async () => { throw new Error('Network failure'); },
    async () => new Response('Unavailable', { status: 503 }),
    async () => Response.json({ unexpected: true }),
  ]) {
    await withServer(upstream, async base => {
      const response = await fetch(`${base}/api/movies`);
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /try again/);
    });
  }
});

test('serves only public movie assets and rejects unsupported methods', async () => {
  await withServer(() => { throw new Error('unused'); }, async base => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Search movies/);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/.git/config`)).status, 404);
    assert.equal((await fetch(`${base}/api/players`)).status, 404);
    assert.equal((await fetch(`${base}/api/matches`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});
