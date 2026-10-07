const form = document.querySelector('#connection-form');
const connect = document.querySelector('#connect');
const cancel = document.querySelector('#cancel-search');
const example = document.querySelector('#try-example');
const message = document.querySelector('#connection-message');
const chain = document.querySelector('#connection-chain');
const title = document.querySelector('#connection-title');
const meta = document.querySelector('#connection-meta');
const note = document.querySelector('#connection-note');
let searchController;

function clearResult() {
  searchController?.abort();
  searchController = null;
  chain.replaceChildren();
  chain.setAttribute('aria-busy', 'false');
  connect.disabled = false;
  connect.textContent = 'Find connection ↗';
  cancel.hidden = true;
  title.textContent = 'Discover the chain';
  meta.textContent = 'FOLLOW THE CAST';
  note.textContent = 'Connections use movie cast credits in Wikidata. Missing credits and search limits can affect the result.';
}

function actorField(prefix) {
  const input = document.querySelector(`#${prefix}-actor`);
  const options = document.querySelector(`#${prefix}-options`);
  const selection = document.querySelector(`#${prefix}-selection`);
  let actor, controller, timer;
  function set(person) {
    clearTimeout(timer);
    controller?.abort();
    actor = person;
    input.value = person.name;
    selection.textContent = person.description;
    options.hidden = true;
    options.replaceChildren();
  }
  async function lookup() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const name = input.value.trim();
    if (name.length < 2) return [];
    selection.textContent = 'Looking up names…';
    try {
      const response = await fetch(`/api/actors?${new URLSearchParams({ name })}`, { signal: current.signal });
      const payload = await response.json();
      if (current.signal.aborted) return [];
      if (!response.ok) throw new Error(payload.error || 'Could not search names. Try again.');
      options.replaceChildren();
      for (const person of payload.actors) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const name = document.createElement('strong');
        name.textContent = person.name;
        const description = document.createElement('span');
        description.textContent = person.description;
        button.append(name, description);
        button.addEventListener('click', () => { clearResult(); set(person); message.textContent = 'Ready when you are. Find the connection between these performers.'; });
        item.append(button);
        options.append(item);
      }
      options.hidden = !payload.actors.length;
      selection.textContent = payload.actors.length ? 'Choose the actor or actress you mean below.' : 'No actors or actresses found. Try a full name or check the spelling.';
      return payload.actors;
    } catch (error) {
      if (!current.signal.aborted) selection.textContent = error.message;
      return [];
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    clearResult();
    actor = null;
    selection.textContent = '';
    options.hidden = true;
    options.replaceChildren();
    message.textContent = 'Choose both actors from the name suggestions, then find their connection.';
    if (input.value.trim().length >= 2) timer = setTimeout(lookup, 400);
  });
  return { set, input, get: () => actor, lookup, stopTimer: () => clearTimeout(timer) };
}
const from = actorField('from'), to = actorField('to');

function addNode(item, type, index) {
  const node = document.createElement('li');
  node.className = `chain-node ${type}-node`;
  const label = document.createElement('p');
  label.className = 'eyebrow';
  label.textContent = type === 'actor' ? (index === 0 ? 'START' : 'PERFORMER') : `MOVIE ${index + 1}`;
  const icon = document.createElement('span');
  icon.className = 'chain-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = type === 'actor' ? item.name.split(' ').map(word => word[0]).join('').slice(0, 2) : '▣';
  const link = document.createElement('a');
  link.href = `https://www.wikidata.org/wiki/${item.id}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = type === 'actor' ? item.name : item.title;
  const detail = document.createElement('small');
  detail.textContent = type === 'actor' ? 'Cast member' : item.year || 'Movie cast credit';
  node.append(label, icon, link, detail);
  chain.append(node);
}

async function searchConnection() {
  from.stopTimer(); to.stopTimer();
  if (!from.get() || !to.get()) {
    message.textContent = 'Choose both actors from the name suggestions first.';
    if (!from.get()) await from.lookup();
    if (!to.get()) await to.lookup();
    return;
  }
  clearResult();
  const current = new AbortController();
  searchController = current;
  chain.setAttribute('aria-busy', 'true');
  connect.disabled = true;
  connect.textContent = 'Finding a connection…';
  cancel.hidden = false;
  meta.textContent = 'EXPLORING SHARED CAST CREDITS';
  message.textContent = `Looking through the movie connections of ${from.get().name} and ${to.get().name}. This can take up to 45 seconds.`;
  try {
    const response = await fetch(`/api/connections?${new URLSearchParams({ from: from.get().id, to: to.get().id })}`, { signal: current.signal });
    const result = await response.json();
    if (current.signal.aborted) return;
    if (!response.ok) throw new Error(result.error || 'Could not find a connection. Please try again.');
    if (result.status === 'found') {
      const count = result.movies.length;
      title.textContent = count ? `Connected in ${count} movie ${count === 1 ? 'link' : 'links'}` : 'That’s the same person!';
      meta.textContent = 'CONNECTION FOUND';
      message.textContent = count ? 'Follow the chain. Each movie lists both people beside it as cast members.' : 'No movie links needed to connect someone to themselves.';
      result.actors.forEach((actor, index) => {
        addNode(actor, 'actor', index);
        if (index < result.movies.length) addNode(result.movies[index], 'movie', index);
      });
      chain.lastElementChild.querySelector('.eyebrow').textContent = count ? 'FINISH' : 'SAME ACTOR';
      note.textContent = `${result.expanded} performer filmographies explored. ${result.limited ? 'A search limit was reached; a shorter chain may exist.' : 'This is a shortest chain in the credits explored.'} Wikidata may have missing or incorrect credits. Open any name or movie to inspect its source.`;
    } else {
      title.textContent = 'No chain found in this search';
      meta.textContent = result.status === 'limit' ? 'SEARCH LIMIT REACHED' : 'NO CONNECTION RETURNED';
      message.textContent = result.status === 'limit' ? 'The search reached its exploration limit. A connection may still exist. Try another pair.' : 'No connection was found within six movie links in the available cast data. Try another pair.';
    }
  } catch (error) {
    if (current.signal.aborted) return;
    meta.textContent = 'SEARCH UNAVAILABLE';
    message.textContent = error.message === 'Failed to fetch' ? 'Could not connect. Check your connection and try again.' : error.message;
  } finally {
    if (searchController === current) {
      chain.setAttribute('aria-busy', 'false');
      connect.disabled = false;
      connect.textContent = 'Find connection ↗';
      cancel.hidden = true;
    }
  }
}
form.addEventListener('submit', event => { event.preventDefault(); searchConnection(); });
cancel.addEventListener('click', () => { clearResult(); message.textContent = 'Search cancelled. You can choose another pair or try again.'; });
example.addEventListener('click', () => {
  clearResult();
  from.set({ id: 'Q503706', name: 'Chris Pratt', description: 'American actor (born 1979)' });
  to.set({ id: 'Q40096', name: 'Will Smith', description: 'American actor, film producer and rapper (born 1968)' });
  searchConnection();
});
