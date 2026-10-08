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

test('returns distinct equally short connections in either direction without an actor preference', async () => {
  const films = [
    { id: 'Zoolander', cast: ['Ferrell', 'Ryder'] },
    { id: 'BlackSwan', cast: ['Ryder', 'Kunis'] },
    { id: 'DaddysHome', cast: ['Ferrell', 'Wahlberg'] },
    { id: 'Ted', cast: ['Wahlberg', 'Kunis'] },
  ];
  for (const [from, to] of [['Ferrell', 'Kunis'], ['Kunis', 'Ferrell']]) {
    const result = await findConnection(actor(from), actor(to), graph(films));
    assert.deepEqual(result.alternatives.map(path => path.actors.map(actor => actor.id)), [[from, 'Ryder', to], [from, 'Wahlberg', to]]);
    assert.ok(result.alternatives.every(path => path.movies.length === 2));
  }
  const direct = await findConnection(actor('Ferrell'), actor('Kunis'), graph([...films, { id: 'Direct', cast: ['Ferrell', 'Kunis'] }]));
  assert.equal(direct.alternatives.length, 1);
  assert.equal(direct.movies.length, 1, 'Longer paths are not included with a direct connection');
  const capped = await findConnection(actor('Ferrell'), actor('Kunis'), graph(films), { maxAlternatives: 1 });
  assert.equal(capped.alternatives.length, 1);
  assert.equal(capped.alternativesLimited, true);
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

test('default search finds chains longer than six movie links while retaining exploration limits', async () => {
  const ids = Array.from({ length: 9 }, (_, index) => `Actor${index}`);
  const films = ids.slice(1).map((id, index) => ({ id: `Movie${index}`, cast: [ids[index], id] }));
  const result = await findConnection(actor(ids[0]), actor(ids.at(-1)), graph(films));
  assert.equal(result.status, 'found');
  assert.equal(result.movies.length, 8);
  assert.deepEqual(result.actors.map(actor => actor.id), ids);
  const limited = await findConnection(actor(ids[0]), actor(ids.at(-1)), graph(films), { maxExpanded: 3 });
  assert.equal(limited.status, 'limit');
  assert.equal(limited.expanded, 3);
  assert.equal(Object.hasOwn(limited, 'maxDepth'), false);
});

test('preserves shared movies for every link when the path expands from both endpoints', async () => {
  const films = [
    { id: 'AB1', cast: ['A', 'B', 'Extra1', 'Extra2'] },
    { id: 'AB2', cast: ['A', 'B'] },
    { id: 'BC', cast: ['B', 'C'] }, { id: 'CD', cast: ['C', 'D'] },
    { id: 'DE1', cast: ['D', 'E'] }, { id: 'DE2', cast: ['D', 'E'] },
  ];
  const neighbors = async ids => {
    const result = await graph(films)(ids);
    return { ...result, edges: result.edges.map(edge => ({ ...edge, movies: films
      .filter(movie => movie.cast.includes(edge.originId) && movie.cast.includes(edge.actor.id))
      .map(movie => ({ id: movie.id, title: movie.id })) })) };
  };
  const result = await findConnection(actor('A'), actor('E'), neighbors);
  assert.deepEqual(result.actors.map(actor => actor.id), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(result.sharedMovies.map(movies => movies.map(movie => movie.id)), [['AB1', 'AB2'], ['BC'], ['CD'], ['DE1', 'DE2']]);
  assert.equal(result.movies.length, 4, 'Multiple movies between a pair still count as one link');
  assert.deepEqual((await findConnection(actor('A'), actor('A'), neighbors)).sharedMovies, []);
});

test('cancellation aborts graph exploration', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(findConnection(actor('A'), actor('B'), graph([]), { signal: controller.signal }), { name: 'AbortError' });
});

test('name lookup excludes nonhuman entities and handles multilingual labels', async () => {
  const provider = createWikidata(async address => {
    const url = new URL(address);
    if (url.hostname === 'query.wikidata.org') return Response.json({ results: { bindings: [] } });
    if (url.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: [{ id: 'Q1' }, { id: 'Q2' }] });
    return Response.json({ entities: {
      Q1: { id: 'Q1', labels: { mul: { value: 'Actor Name' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q33999' } } } }] } },
      Q2: { id: 'Q2', labels: { en: { value: 'Movie title' } }, claims: {} },
    } });
  });
  assert.deepEqual((await provider.actors('Name')).map(actor => actor.name), ['Actor Name']);
  assert.equal(validId('Q123'), true);
  assert.equal(validId('Q1 } UNION { ?s ?p ?o'), false);
});

test('actor suggestions exclude unrelated humans and include specialized acting occupations', async () => {
  const claim = (id, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value: { id } } } });
  const human = (id, name, occupations = []) => ({ id, labels: { en: { value: name } }, claims: { P31: [claim('Q5')], P106: occupations } });
  const records = {
    Q1: human('Q1', 'Anne Hathaway', [claim('Q33999')]),
    Q2: human('Q2', 'Anne Hathaway, wife of William Shakespeare'),
    Q3: human('Q3', 'Mary Bigelow Ingham', [claim('Q49757')]),
    Q4: human('Q4', 'Voice performer', [claim('Q10800557')]),
    Q6: human('Q6', 'Former incorrect actor claim', [claim('Q33999', 'deprecated')]),
    Q7: { id: 'Q7', claims: { P106: [claim('Q33999')] } },
    Q8: human('Q8', 'Actor without an acting description', [claim('Q33999')]),
  };
  let occupationRequests = 0;
  const provider = createWikidata(async address => {
    const url = new URL(address);
    if (url.hostname === 'query.wikidata.org') {
      occupationRequests++;
      return Response.json({ results: { bindings: [{ occupation: { value: 'http://www.wikidata.org/entity/Q10800557' } }] } });
    }
    if (url.searchParams.get('action') === 'wbsearchentities') {
      assert.equal(url.searchParams.get('limit'), '30');
      return Response.json({ search: Object.keys(records).map(id => ({ id })) });
    }
    return Response.json({ entities: records });
  });
  assert.deepEqual((await provider.actors('Anne Hathaway')).map(actor => actor.id), ['Q1', 'Q4', 'Q8']);
  await provider.actors('Other name');
  assert.equal(occupationRequests, 1, 'Acting occupations are reused between searches');
});

test('actor suggestions keep search relevance order and return at most eight actors', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `Q${index + 100}`);
  const provider = createWikidata(async address => {
    const url = new URL(address);
    if (url.hostname === 'query.wikidata.org') return Response.json({ results: { bindings: [] } });
    if (url.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: ids.map(id => ({ id })) });
    return Response.json({ entities: Object.fromEntries(ids.map(id => [id, { id, claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
      P106: [{ mainsnak: { datavalue: { value: { id: 'Q33999' } } } }],
    } }])) });
  });
  assert.deepEqual((await provider.actors('Name')).map(actor => actor.id), ids.slice(0, 8));
});

test('excludes pornographic performers and erotic models even with a general acting occupation', async () => {
  const claim = (id, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value: { id } } } });
  const human = (id, occupations, description = 'Actor') => ({ id, labels: { en: { value: id } }, descriptions: { en: { value: description } }, claims: { P31: [claim('Q5')], P106: [claim('Q33999'), ...occupations] } });
  const records = {
    Q1: human('Q1', [claim('Q488111')]),
    Q2: human('Q2', [claim('Q3286043')]),
    Q3: human('Q3', [claim('Q900001')]),
    Q4: human('Q4', [], 'American pornographic actress'),
    Q6: human('Q6', [], 'Ukrainian erotic model'),
    Q7: human('Q7', [claim('Q488111', 'deprecated')], 'Film actress'),
    Q8: human('Q8', [], 'Actress and fashion model'),
  };
  const provider = createWikidata(async address => {
    const url = new URL(address);
    if (url.hostname === 'query.wikidata.org') {
      assert.ok(url.searchParams.get('query').includes('wd:Q3286043'));
      return Response.json({ results: { bindings: [{ occupation: { value: 'http://www.wikidata.org/entity/Q900001' }, excluded: { value: 'true' } }] } });
    }
    if (url.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: Object.keys(records).map(id => ({ id })) });
    return Response.json({ entities: records });
  });
  assert.deepEqual((await provider.actors('Name')).map(actor => actor.id), ['Q7', 'Q8']);
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4', 'Q6']) await assert.rejects(provider.people([id]), /excluded from this app/);
  assert.deepEqual((await provider.people(['Q8'])).map(actor => actor.id), ['Q8']);
  assert.deepEqual((await provider.people(['Q1', 'Q8'], undefined, { skipExcluded: true })).map(actor => actor.id), ['Q8']);
  await assert.rejects(provider.people(['Q1', 'Q8']), /excluded from this app/, 'Skipping exclusions must not bypass later strict validation');
});

test('cast adapter retains all shared movies, deduplicates dates, and prefers the most recent movie', async () => {
  const binding = (movie, title, year) => ({ origin: { value: 'http://www.wikidata.org/entity/Q1' }, actor: { value: 'http://www.wikidata.org/entity/Q2' }, actorLabel: { value: 'Other actor' }, movie: { value: `http://www.wikidata.org/entity/${movie}` }, movieLabel: { value: title }, date: { value: `${year}-01-01T00:00:00Z` } });
  const provider = createWikidata(async () => Response.json({ results: { bindings: [binding('Q10', 'Older movie', 2018), binding('Q11', 'Newer movie', 2022), binding('Q11', 'Newer movie', 2023), binding('Q12', 'Undated movie', null)] } }));
  const result = await provider.neighbors(['Q1']);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].movie.title, 'Newer movie');
  assert.equal(result.edges[0].movie.year, '2022');
  assert.deepEqual(result.edges[0].movies, [
    { id: 'Q11', title: 'Newer movie', year: '2022' },
    { id: 'Q10', title: 'Older movie', year: '2018' },
    { id: 'Q12', title: 'Undated movie', year: null },
  ]);
});

test('cast queries reuse resolved exclusion subclasses rather than traversing them for every performer', async () => {
  let occupationRequests = 0;
  const provider = createWikidata(async address => {
    const query = new URL(address).searchParams.get('query');
    if (query.includes('SELECT DISTINCT ?occupation')) {
      occupationRequests++;
      return Response.json({ results: { bindings: [{ occupation: { value: 'http://www.wikidata.org/entity/Q900001' }, excluded: { value: 'true' } }] } });
    }
    assert.ok(query.includes('wd:Q900001'), 'Specialized excluded occupations are retained');
    assert.ok(query.includes('?actor wdt:P106 ?excludedOccupation.'));
    assert.ok(!query.includes('?actor wdt:P106/wdt:P279*'));
    assert.ok(query.includes('?movie rdfs:label ?movieLabel.'));
    assert.ok(!query.includes('?actorLabel'), 'Actor names are fetched only for the final path');
    return Response.json({ results: { bindings: [] } });
  });
  await provider.neighbors(['Q1']);
  await provider.neighbors(['Q2']);
  assert.equal(occupationRequests, 1);
});

test('does not supplement missing Wikidata cast credits', async () => {
  const provider = createWikidata(async () => Response.json({ results: { bindings: [] } }));
  for (const from of ['Q218503', 'Q164119']) {
    const result = await provider.neighbors([from]);
    assert.deepEqual(result.edges, []);
  }
});

test('upstream timeouts and network failures produce friendly messages and preserve caller cancellation', async () => {
  const timeout = createWikidata(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
  await assert.rejects(timeout.actors('Name'), /Wikidata took too long to respond. Please try again./);
  const offline = createWikidata(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(offline.actors('Name'), /Could not reach Wikidata. Please try again shortly./);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(offline.people(['Q1'], controller.signal), { name: 'TypeError' });
});

test('connection API validates IDs and returns source-backed paths', async () => {
  const human = id => ({ id, labels: { en: { value: `Actor ${id}` } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } });
  const server = createAppServer(async address => {
    const url = new URL(address);
    if (url.hostname === 'www.wikidata.org') return Response.json({ entities: Object.fromEntries(url.searchParams.get('ids').split('|').map(id => [id, human(id)])) });
    return Response.json({ results: { bindings: ['Shared movie', 'Another shared movie'].map((title, index) => ({ origin: { value: 'http://www.wikidata.org/entity/Q1' }, actor: { value: 'http://www.wikidata.org/entity/Q2' }, movie: { value: `http://www.wikidata.org/entity/Q${10 + index}` }, movieLabel: { value: title } })) } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/connections?from=invalid&to=Q2`)).status, 400);
    assert.equal((await fetch(`${base}/api/actors?name=a`)).status, 400);
    const response = await fetch(`${base}/api/connections?from=Q1&to=Q2`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.sharedMovies[0].map(movie => movie.title), ['Another shared movie', 'Shared movie']);
    assert.equal(result.movies.length, 1);
    assert.equal(result.actors[0].name, 'Actor Q1');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
