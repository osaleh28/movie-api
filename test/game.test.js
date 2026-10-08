import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, challenges } from '../game.js';
import { createAppServer } from '../server.js';

const actor = id => ({ id, name: `Performer ${id}` });
const provider = {
  roundCredits: async () => ({ from: actor('Q1'), to: actor('Q2'), movies: [
    { id: 'Q10', title: 'First movie', cast: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'] },
    { id: 'Q11', title: 'Second movie', cast: ['Q1', 'Q2', 'Q3', 'Q4'] },
  ] }),
  people: async ids => ids.map(actor),
};
test('plays the full collection before repeating, including puzzles beyond the original five', async () => {
  const game = createGame({
    roundCredits: async ([fromId, toId, firstId, secondId]) => ({ from: actor(fromId), to: actor(toId), movies: [
      { id: firstId, title: 'First movie', cast: [fromId, 'Q3'] },
      { id: secondId, title: 'Second movie', cast: [toId, 'Q3'] },
    ] }),
    people: provider.people,
  });
  const played = new Set();
  for (let index = 0; index < challenges.length; index++) {
    const round = await game.start(index);
    const pair = round.movies.map(movie => movie.id).sort().join('|');
    assert.equal(played.has(pair), false, `Repeated movie pair at puzzle ${index + 1}`);
    played.add(pair);
    assert.equal(round.from.id, challenges[index][0]);
    assert.equal(game.act(round.id, 'guess', 'Q3').correct, true);
  }
  assert.ok(played.size > 5);
  const repeat = await game.start(challenges.length);
  assert.deepEqual(repeat.movies.map(movie => movie.id), challenges[0].slice(2));
});
test('round hides answers and casts; accepts any shared performer except endpoints', async () => {
  const game = createGame(provider);
  const round = await game.start();
  assert.equal(round.answers, undefined);
  assert.equal(round.movies[0].cast, undefined);
  assert.equal(JSON.stringify(round).includes('Q3'), false);
  const wrong = game.act(round.id, 'guess', 'Q1');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.scoreDelta, -25);
  assert.equal(wrong.answers, undefined);
  const result = game.act(round.id, 'guess', 'Q4');
  assert.equal(result.correct, true);
  assert.equal(result.points, 75);
  assert.equal(result.scoreDelta, 100);
  assert.deepEqual(result.answers.map(x => x.id), ['Q3', 'Q4']);
  assert.throws(() => game.act(round.id, 'guess', 'Q4'), /finished/);
});
test('hints deduct once, duplicate guesses do not consume attempts, and three misses end round', async () => {
  const game = createGame(provider);
  const round = await game.start();
  assert.equal(game.act(round.id, 'hint').scoreDelta, -25);
  assert.equal(game.act(round.id, 'hint').scoreDelta, 0);
  assert.equal(game.act(round.id, 'guess', 'Q3').points, 75);
  const next = await game.start();
  assert.equal(game.act(next.id, 'guess', 'Q5').attemptsLeft, 2);
  assert.throws(() => game.act(next.id, 'guess', 'Q5'), /already tried/);
  assert.equal(game.act(next.id, 'guess', 'Q6').attemptsLeft, 1);
  const last = game.act(next.id, 'guess', 'Q7');
  assert.equal(last.done, true); assert.equal(last.points, 0);
  assert.equal(last.scoreDelta, -25);
  assert.equal(last.answers.length, 2);
});
test('reveals finish without awarding points and invalid actions leave round playable', async () => {
  const game = createGame(provider), round = await game.start();
  assert.throws(() => game.act('missing', 'guess', 'Q3'), /expired/);
  assert.throws(() => game.act(round.id, 'guess', 'invalid'), /Choose an actor/);
  assert.throws(() => game.act(round.id, 'other'), /Choose an actor/);
  const result = game.act(round.id, 'reveal');
  assert.equal(result.points, 0); assert.equal(result.done, true);
  assert.equal(result.scoreDelta, -25);
  assert.throws(() => game.act(round.id, 'hint'), /finished/);
  assert.throws(() => game.act(round.id, 'reveal'), /finished/);
});

test('revealing before three misses charges 25 once in addition to previous guesses and hints', async () => {
  const game = createGame(provider);
  for (const misses of [0, 1, 2]) {
    for (const hinted of [false, true]) {
      const round = await game.start();
      let total = 0;
      for (let index = 0; index < misses; index++) total += game.act(round.id, 'guess', `Q${index + 5}`).scoreDelta;
      if (hinted) total += game.act(round.id, 'hint').scoreDelta;
      const revealed = game.act(round.id, 'reveal');
      assert.equal(revealed.scoreDelta, -25);
      assert.equal(total + revealed.scoreDelta, -25 * (misses + Number(hinted) + 1));
      assert.equal(revealed.done, true);
      assert.throws(() => game.act(round.id, 'reveal'), /finished/);
    }
  }
});
test('game HTTP API verifies cast credits, awards points, and removes movie catalog routes', async () => {
  const human = id => ({ id, labels: { en: { value: `Actor ${id}` } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } });
  const film = (id, cast) => ({ id, labels: { en: { value: `Film ${id}` } }, claims: { P161: cast.map(id => ({ mainsnak: { datavalue: { value: { id } } } })) } });
  const server = createAppServer(async address => {
    if (new URL(address).hostname === 'query.wikidata.org') return Response.json({ results: { bindings: [] } });
    const ids = new URL(address).searchParams.get('ids').split('|');
    return Response.json({ entities: Object.fromEntries(ids.map(id => [id, id === 'Q55178974' ? film(id, ['Q503706', 'Q106706']) : id === 'Q105387' ? film(id, ['Q40096', 'Q106706']) : human(id)])) });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/api/game', { method: 'POST', body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/movies')).status, 404);
    assert.equal((await fetch(base + '/app.js')).status, 404);
    assert.equal((await post(null)).status, 400);
    assert.equal((await post({ action: 'start', index: -1 })).status, 400);
    assert.equal((await post({ action: 'start', index: 1.5 })).status, 400);
    const response = await post({ action: 'start', index: 0 });
    assert.equal(response.status, 200);
    const round = await response.json();
    assert.equal(JSON.stringify(round).includes('Q106706'), false);
    const guess = await post({ action: 'guess', id: round.id, actorId: 'Q106706' });
    const result = await guess.json();
    assert.equal(result.correct, true); assert.equal(result.points, 100);
    assert.equal((await post({ action: 'guess', id: round.id, actorId: 'Q106706' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
