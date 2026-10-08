import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createGame } from '../game.js';

class Element {
  children = [];
  handlers = new Map();
  textContent = '0';
  value = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(event, handler) { this.handlers.set(event, handler); }
  focus() {}
}

test('round history survives page reloads, rolls over, and ignores failed starts', async () => {
  const source = await readFile(new URL('../public/game-ui.js', import.meta.url), 'utf8');
  const storage = new Map();
  let failNext = false;
  const loadPage = async (expected, nextIndex) => {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    };
    const context = vm.createContext({
      document: { getElementById: element, createElement: () => new Element() },
      AbortSignal, setTimeout, clearTimeout,
      localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      fetch: async (url, options) => {
        const input = JSON.parse(options.body);
        assert.deepEqual(input, { action: 'start', played: expected });
        if (failNext) { failNext = false; return Response.json({ error: 'Please try again.' }, { status: 503 }); }
        return Response.json({ id: 'round', challengeIndex: nextIndex, challengeCount: 3,
          from: { id: 'Q1', name: 'First actor' }, to: { id: 'Q2', name: 'Second actor' },
          movies: [{ id: 'Q10', title: 'First movie' }, { id: 'Q11', title: 'Second movie' }] });
      },
    });
    vm.runInContext(source, context);
    await element('next-round').handlers.get('click')();
  };
  await loadPage([], 2);
  await loadPage([2], 0);
  failNext = true;
  await loadPage([2, 0], 1);
  assert.deepEqual(JSON.parse(storage.get('reel-connections-played')), [2, 0]);
  await loadPage([2, 0], 1);
  await loadPage([2, 0, 1], 2);
  assert.deepEqual(JSON.parse(storage.get('reel-connections-played')), [2]);
  storage.set('reel-connections-played', '{invalid JSON');
  await loadPage([], 1);
  assert.deepEqual(JSON.parse(storage.get('reel-connections-played')), [1]);
});

test('scoreboard immediately deducts misses and hints, preserves penalties, and never charges twice', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const actor = id => ({ id, name: `Actor ${id}`, description: 'Actor' });
  const game = createGame({
    roundCredits: async () => ({ from: actor('Q1'), to: actor('Q2'), movies: [
      { id: 'Q10', title: 'First movie', cast: ['Q1', 'Q3'] },
      { id: 'Q11', title: 'Second movie', cast: ['Q2', 'Q3'] },
    ] }),
    people: async ids => ids.map(actor),
  });
  const timers = new Map();
  let failNext = false;
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => new Element() },
    AbortController, AbortSignal, URLSearchParams,
    setTimeout: callback => { timers.set(callback, callback); return callback; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      if (url.startsWith('/api/actors')) {
        return Response.json({ actors: [actor(new URL(url, 'http://localhost').searchParams.get('name'))] });
      }
      if (failNext) { failNext = false; return Response.json({ error: 'Please try again.' }, { status: 503 }); }
      const input = JSON.parse(options.body);
      try {
        return Response.json(input.action === 'start' ? await game.start() : game.act(input.id, input.action, input.actorId));
      } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    },
  });
  vm.runInContext(await readFile(new URL('../public/game-ui.js', import.meta.url), 'utf8'), context);
  const click = id => element(id).handlers.get('click')();
  const guess = async id => {
    element('guess-actor').value = id;
    element('guess-actor').handlers.get('input')();
    for (const [key, callback] of timers) { timers.delete(key); await callback(); }
    element('guess-options').children[0].children[0].handlers.get('click')();
    await element('guess-form').handlers.get('submit')({ preventDefault() {} });
  };
  const score = () => Number(element('game-score').textContent);
  await click('next-round');
  await guess('Q5');
  assert.equal(score(), -25, 'A wrong guess immediately updates the total');
  await guess('Q5');
  assert.equal(score(), -25, 'A rejected duplicate guess does not charge again');
  failNext = true;
  await click('game-hint');
  assert.equal(score(), -25, 'A failed request does not change the score');
  await click('game-hint');
  assert.equal(score(), -50, 'A hint immediately deducts another 25');
  await guess('Q3');
  assert.equal(score(), 50, 'A win adds 100 without charging prior penalties again');
  assert.equal(Number(element('game-wins').textContent), 1);
  await click('next-round');
  assert.equal(score(), 50, 'Starting another round keeps the total');
  await guess('Q5'); await guess('Q6'); await guess('Q7');
  assert.equal(score(), -25, 'All three misses are charged, including the final one');
  assert.equal(Number(element('game-wins').textContent), 1);
  await click('next-round');
  await guess('Q5');
  await click('game-reveal');
  assert.equal(score(), -75, 'Revealing immediately deducts 25 in addition to the wrong guess');
  await click('game-reveal');
  assert.equal(score(), -75, 'A repeated reveal cannot deduct points again');
  await click('next-round');
  await click('game-hint');
  await click('next-round');
  assert.equal(score(), -100, 'Skipping keeps a hint deduction in place');
});
