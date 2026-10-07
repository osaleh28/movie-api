const idPattern = /^Q[1-9]\d*$/;
export const validId = id => typeof id === 'string' && idPattern.test(id);
const entityId = value => value?.split('/').at(-1);
const headers = { 'User-Agent': 'ReelActorConnections/1.0 (local educational movie app)', Accept: 'application/json' };

export function createWikidata(fetchApi = fetch) {
  const cache = new Map();
  const pending = new Map();
  async function json(url, signal) {
    const response = await fetchApi(url, { headers, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Wikidata is busy. Please wait a minute and try again.' : 'Could not reach Wikidata. Please try again shortly.');
    return response.json();
  }
  async function cached(key, load) {
    const old = cache.get(key);
    if (old && Date.now() - old.at < 1800000) return old.value;
    if (pending.has(key)) return pending.get(key);
    const job = load();
    pending.set(key, job);
    try {
      const value = await job;
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), value });
      return value;
    } finally { pending.delete(key); }
  }
  async function entities(ids, signal) {
    if (!ids.length) return {};
    if (ids.some(id => !validId(id))) throw new Error('Invalid person ID.');
    const data = await json('https://www.wikidata.org/w/api.php?' + new URLSearchParams({
      action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims', languages: 'en|mul', languagefallback: '1', format: 'json',
    }), signal);
    if (!data.entities) throw new Error('Unexpected response from Wikidata.');
    return data.entities;
  }
  const person = entity => ({ id: entity.id, name: entity.labels?.en?.value || entity.labels?.mul?.value || entity.id, description: entity.descriptions?.en?.value || 'Performer' });
  const isHuman = entity => entity?.claims?.P31?.some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5');
  async function actorOccupations() {
    return cached('actor-occupations', async () => {
      // Include specialized acting occupations through Wikidata's subclass hierarchy.
      const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
SELECT DISTINCT ?occupation WHERE { ?occupation wdt:P279* wd:Q33999. }`;
      const data = await json('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }));
      if (!Array.isArray(data.results?.bindings)) throw new Error('Unexpected actor-occupation response.');
      return new Set(['Q33999', ...data.results.bindings.map(row => entityId(row.occupation?.value)).filter(validId)]);
    });
  }
  async function actors(name) {
    return cached(`search:${name.toLocaleLowerCase()}`, async () => {
      const data = await json('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'en', format: 'json', limit: '30', type: 'item' }));
      if (!Array.isArray(data.search)) throw new Error('Unexpected actor-search response.');
      const ids = data.search.map(item => item.id).filter(validId);
      if (!ids.length) return [];
      const [records, occupations] = await Promise.all([entities(ids), actorOccupations()]);
      return ids.filter(id => isHuman(records[id]) && records[id].claims?.P106?.some(claim =>
        claim.rank !== 'deprecated' && occupations.has(claim.mainsnak?.datavalue?.value?.id)
      )).slice(0, 8).map(id => person(records[id]));
    });
  }
  async function people(ids, signal) {
    // Game answers repeat between rounds. Cache them without sharing a search's abort signal.
    const load = async () => {
      const records = await entities([...new Set(ids)], signal);
      return ids.map(id => {
        if (!isHuman(records[id])) throw new Error('Choose a person from the name suggestions.');
        return person(records[id]);
      });
    };
    return signal ? load() : cached(`people:${ids.join(',')}`, load);
  }
  async function neighbors(ids, signal) {
    if (ids.some(id => !validId(id))) throw new Error('Invalid person ID.');
    // Cache completed query results; each search keeps its own abortable requests.
    const key = `cast:${[...ids].sort().join(',')}`;
    const old = cache.get(key);
    if (old && Date.now() - old.at < 1800000) return old.value;
    const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT DISTINCT ?origin ?movie ?movieLabel ?actor ?actorLabel ?date WHERE {
  VALUES ?origin { ${ids.map(id => `wd:${id}`).join(' ')} }
  ?movie wdt:P161 ?origin; wdt:P161 ?actor.
  ?movie wdt:P31/wdt:P279* wd:Q11424.
  FILTER(?origin != ?actor)
  OPTIONAL { ?movie wdt:P577 ?date. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 12001`;
    const data = await json('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }), signal);
    const rows = data.results?.bindings;
    if (!Array.isArray(rows)) throw new Error('Unexpected cast-credit response.');
    const movies = new Map();
    for (const row of rows.slice(0, 12000)) {
      const id = entityId(row.movie?.value);
      if (!validId(id)) continue;
      const year = /^\d{4}-/.test(row.date?.value || '') ? row.date.value.slice(0, 4) : null;
      const existing = movies.get(id);
      if (!existing) movies.set(id, { id, title: row.movieLabel?.value || id, year });
      else if (year && (!existing.year || Number(year) < Number(existing.year))) existing.year = year;
    }
    const edges = new Map();
    for (const row of rows.slice(0, 12000)) {
      const originId = entityId(row.origin?.value), actorId = entityId(row.actor?.value), movieId = entityId(row.movie?.value);
      if (![originId, actorId, movieId].every(validId)) continue;
      const edge = { originId, actor: { id: actorId, name: row.actorLabel?.value || actorId }, movie: movies.get(movieId) };
      const key = `${originId}:${actorId}`;
      // Prefer the most recent movie when two people have multiple shared credits.
      if (!edges.has(key) || Number(edge.movie.year) > Number(edges.get(key).movie.year)) edges.set(key, edge);
    }
    const value = { edges: [...edges.values()], truncated: rows.length > 12000 };
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  async function roundCredits(ids) {
    return cached(`round:${ids.join(',')}`, async () => {
      const records = await entities(ids);
      const [fromId, toId, ...filmIds] = ids;
      if (!isHuman(records[fromId]) || !isHuman(records[toId])) throw new Error('This round’s performers are unavailable. Try again.');
      const movies = filmIds.map(id => {
        const record = records[id];
        if (!record?.claims?.P161?.length) throw new Error('This round’s movie credits are unavailable. Try again.');
        const dates = (record.claims.P577 || []).map(claim => claim.mainsnak?.datavalue?.value?.time).filter(time => /^\+\d{4}-/.test(time || '')).sort();
        return { id, title: record.labels?.en?.value || record.labels?.mul?.value || id, year: dates[0]?.slice(1, 5) || null, cast: [...new Set(record.claims.P161.map(claim => claim.mainsnak?.datavalue?.value?.id).filter(validId))] };
      });
      return { from: person(records[fromId]), to: person(records[toId]), movies };
    });
  }
  return { actors, people, neighbors, roundCredits };
}
