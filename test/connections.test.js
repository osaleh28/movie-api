import test from 'node:test';
import assert from 'node:assert/strict';
import { findConnection } from '../connections.js';
import { createWikidata, validId } from '../wikidata.js';
import { createAppServer } from '../server.js';

function graph(films) {
  return async ids => ({ edges: films.flatMap(movie => ids.flatMap(originId => movie.cast.includes(originId) ? movie.cast.filter(id => id !== originId).map(id => ({ originId, actor: { id, name: id }, movie: { id: movie.id, title: movie.title } })) : [])), truncated: false });
}
const actor = id => ({ id, name: id });

test('connects Chris Pratt to Will Smith through Jeff Goldblum and two films', async () => {
  const result = await findConnection(actor('Pratt'), actor('Smith'), graph([
    { id: 'Dominion', title: 'Jurassic World Dominion', cast: ['Pratt', 'Goldblum'] },
    { id: 'Independence', title: 'Independence Day', cast: ['Goldblum', 'Smith'] },
  ]));
  assert.equal(result.status, 'found');
  assert.deepEqual(result.actors.map(actor => actor.id), ['Pratt', 'Goldblum', 'Smith']);
  assert.deepEqual(result.movies.map(movie => movie.id), ['Dominion', 'Independence']);
});

test('finds direct and zero-link paths instead of longer alternatives', async () => {
  const data = graph([{ id: 'AB', title: 'Shared movie', cast: ['A', 'B'] }, { id: 'AC', cast: ['A', 'C'] }, { id: 'CB', cast: ['C', 'B'] }]);
  assert.equal((await findConnection(actor('A'), actor('B'), data)).movies.length, 1);
  assert.equal((await findConnection(actor('A'), actor('A'), data)).movies.length, 0);
});

test('reconstructs longer chains correctly when expanding from either endpoint', async () => {
  const films = [
    { id: 'AB', cast: ['A', 'B', 'Extra1', 'Extra2'] },
    { id: 'BC', cast: ['B', 'C'] }, { id: 'CD', cast: ['C', 'D'] },
    { id: 'DE', cast: ['D', 'E'] },
  ];
  const result = await findConnection(actor('A'), actor('E'), graph(films));
  assert.deepEqual(result.actors.map(actor => actor.id), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(result.movies.map(movie => movie.id), ['AB', 'BC', 'CD', 'DE']);
});

test('cycles, disconnected actors, depth caps, and exploration limits terminate', async () => {
  const data = graph([{ id: 'AB', cast: ['A', 'B', 'C'] }, { id: 'CD', cast: ['C', 'D'] }, { id: 'DE', cast: ['D', 'E'] }]);
  assert.equal((await findConnection(actor('A'), actor('Z'), data)).status, 'not-found');
  assert.equal((await findConnection(actor('A'), actor('E'), data, { maxDepth: 1 })).status, 'not-found');
  assert.equal((await findConnection(actor('A'), actor('E'), data, { maxExpanded: 1 })).status, 'limit');
  assert.equal((await findConnection(actor('A'), actor('E'), async ids => ({ ...(await data(ids)), truncated: true }))).status, 'limit');
});

test('cancellation aborts graph exploration', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(findConnection(actor('A'), actor('B'), graph([]), { signal: controller.signal }), { name: 'AbortError' });
});

test('name lookup excludes nonhuman entities and handles multilingual labels', async () => {
  const provider = createWikidata(async address => {
    const url = new URL(address);
    if (url.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: [{ id: 'Q1' }, { id: 'Q2' }] });
    return Response.json({ entities: {
      Q1: { id: 'Q1', labels: { mul: { value: 'Actor Name' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } },
      Q2: { id: 'Q2', labels: { en: { value: 'Movie title' } }, claims: {} },
    } });
  });
  assert.deepEqual((await provider.actors('Name')).map(actor => actor.name), ['Actor Name']);
  assert.equal(validId('Q123'), true);
  assert.equal(validId('Q1 } UNION { ?s ?p ?o'), false);
});

test('cast adapter combines duplicate release dates and keeps the most recent shared movie', async () => {
  const binding = (movie, title, year) => ({ origin: { value: 'http://www.wikidata.org/entity/Q1' }, actor: { value: 'http://www.wikidata.org/entity/Q2' }, actorLabel: { value: 'Other actor' }, movie: { value: `http://www.wikidata.org/entity/${movie}` }, movieLabel: { value: title }, date: { value: `${year}-01-01T00:00:00Z` } });
  const provider = createWikidata(async () => Response.json({ results: { bindings: [binding('Q10', 'Older movie', 2018), binding('Q11', 'Newer movie', 2022), binding('Q11', 'Newer movie', 2023)] } }));
  const result = await provider.neighbors(['Q1']);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].movie.title, 'Newer movie');
  assert.equal(result.edges[0].movie.year, '2022');
});

test('connection API validates IDs and returns source-backed paths', async () => {
  const human = id => ({ id, labels: { en: { value: `Actor ${id}` } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } });
  const server = createAppServer(async address => {
    const url = new URL(address);
    if (url.hostname === 'www.wikidata.org') return Response.json({ entities: Object.fromEntries(url.searchParams.get('ids').split('|').map(id => [id, human(id)])) });
    return Response.json({ results: { bindings: [{ origin: { value: 'http://www.wikidata.org/entity/Q1' }, actor: { value: 'http://www.wikidata.org/entity/Q2' }, movie: { value: 'http://www.wikidata.org/entity/Q10' }, movieLabel: { value: 'Shared movie' } }] } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/connections?from=invalid&to=Q2`)).status, 400);
    assert.equal((await fetch(`${base}/api/actors?name=a`)).status, 400);
    const response = await fetch(`${base}/api/connections?from=Q1&to=Q2`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.movies[0].title, 'Shared movie');
    assert.equal(result.actors[0].name, 'Actor Q1');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
