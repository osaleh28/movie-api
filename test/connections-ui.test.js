import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  children = [];
  handlers = new Map();
  textContent = '';
  value = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(event, handler) { this.handlers.set(event, handler); }
  querySelector(selector) { return this.children.find(child => `.${child.className}` === selector); }
  get lastElementChild() { return this.children.at(-1); }
}

test('repeated Find connection clicks display each different chain before wrapping, without another API call', async () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const actor = (id, name) => ({ id, name });
  const movie = { id: 'Q100', title: 'Shared movie', year: '2020' };
  const alternatives = ['First bridge', 'Second bridge'].map((name, index) => ({
    actors: [actor('Q503706', 'Chris Pratt'), actor(`Q${index + 10}`, name), actor('Q40096', 'Will Smith')],
    movies: [movie, movie], sharedMovies: [[movie], [movie]],
  }));
  let requests = 0;
  const context = vm.createContext({
    document: { querySelector: element, createElement: () => new Element() },
    AbortController, URLSearchParams, setTimeout, clearTimeout,
    fetch: async () => {
      requests++;
      return Response.json({ status: 'found', ...alternatives[0], alternatives, expanded: 2, limited: false });
    },
  });
  vm.runInContext(await readFile(new URL('../public/connections-ui.js', import.meta.url), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  element('#try-example').handlers.get('click')();
  await settle();
  assert.equal(element('#connection-meta').textContent, 'CONNECTION 1 OF 2');
  assert.equal(element('#connection-chain').children[2].children[2].textContent, 'First bridge');
  for (const [number, name] of [[2, 'Second bridge'], [1, 'First bridge']]) {
    element('#connection-form').handlers.get('submit')({ preventDefault() {} });
    await settle();
    assert.equal(element('#connection-meta').textContent, `CONNECTION ${number} OF 2`);
    assert.equal(element('#connection-chain').children[2].children[2].textContent, name);
    assert.equal(element('#connect').disabled, false);
  }
  assert.equal(requests, 1);
  assert.ok(element('#connection-message').textContent.includes('next chain'));
});
