const $ = id => document.getElementById(id);
let round, roundIndex = 0, selected, timer, lookupController, lookupVersion = 0, busy = false;
let score = 0, wins = 0;
const message = text => { $('game-message').textContent = text; };
async function api(input) {
  const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load this round. Please try again.');
  return data;
}
function lock(value) {
  busy = value;
  for (const id of ['next-round', 'game-hint', 'game-reveal', 'guess-button', 'guess-actor']) $(id).disabled = value;
}
function clearGuess() {
  clearTimeout(timer); lookupController?.abort(); lookupVersion++;
  selected = null; $('guess-actor').value = ''; $('guess-options').replaceChildren(); $('guess-options').hidden = true;
  $('guess-selection').textContent = 'Choose a performer from the suggestions.';
}
function renderChain(answer) {
  const chain = $('game-chain'); chain.replaceChildren(); chain.hidden = false;
  const nodes = [round.from, round.movies[0], answer || null, round.movies[1], round.to];
  nodes.forEach((node, index) => {
    const li = document.createElement('li'); li.className = 'puzzle-node' + (index % 2 ? ' puzzle-movie' : '') + (!node ? ' mystery-node' : '');
    const label = document.createElement('small'); label.textContent = index % 2 ? 'SHARED MOVIE' : !node ? 'MISSING PERFORMER' : 'PERFORMER';
    const name = document.createElement(node ? 'a' : 'strong'); name.textContent = node ? (node.name || node.title) : '?';
    if (node) { name.href = `https://www.wikidata.org/wiki/${node.id}`; name.target = '_blank'; name.rel = 'noreferrer'; }
    li.append(label, name);
    if (node?.year) { const year = document.createElement('small'); year.textContent = node.year; li.append(year); }
    chain.append(li);
  });
}
async function start() {
  if (busy) return;
  lock(true); clearGuess(); message('Checking the movie cast credits…');
  $('guess-form').hidden = true; $('game-hint').hidden = true; $('game-reveal').hidden = true;
  $('game-chain').hidden = true;
  try {
    round = await api({ action: 'start', index: roundIndex });
    roundIndex++;
    renderChain(); $('guess-form').hidden = false; $('game-hint').hidden = false; $('game-hint').disabled = false; $('game-reveal').hidden = false;
    $('next-round').textContent = 'Skip / next round ↗';
    message('Who connects these stars? You have 3 guesses.');
  } catch (error) {
    round = null; message(error.message); $('next-round').textContent = 'Try again ↗';
  } finally { lock(false); }
}
async function lookup() {
  const query = $('guess-actor').value.trim(), version = ++lookupVersion;
  lookupController?.abort(); lookupController = new AbortController();
  if (query.length < 2) return;
  $('guess-selection').textContent = 'Searching performers…';
  try {
    const response = await fetch('/api/actors?' + new URLSearchParams({ name: query }), { signal: lookupController.signal });
    const data = await response.json();
    if (version !== lookupVersion) return;
    if (!response.ok) throw new Error(data.error);
    $('guess-options').replaceChildren();
    for (const actor of data.actors) {
      const li = document.createElement('li'), button = document.createElement('button'), name = document.createElement('strong'), description = document.createElement('span');
      button.type = 'button'; name.textContent = actor.name; description.textContent = actor.description;
      button.append(name, description); li.append(button); $('guess-options').append(li);
      button.addEventListener('click', () => { selected = actor; $('guess-actor').value = actor.name; $('guess-options').hidden = true; $('guess-selection').textContent = actor.description; $('guess-button').focus(); });
    }
    $('guess-options').hidden = !data.actors.length;
    $('guess-selection').textContent = data.actors.length ? 'Choose the right performer below.' : 'No actors or actresses found. Try another name.';
  } catch (error) { if (error.name !== 'AbortError' && version === lookupVersion) $('guess-selection').textContent = error.message; }
}
$('guess-actor').addEventListener('input', () => {
  selected = null; clearTimeout(timer); lookupController?.abort(); lookupVersion++;
  $('guess-options').hidden = true; $('guess-selection').textContent = 'Choose a performer from the suggestions.';
  timer = setTimeout(lookup, 500);
});
function finish(result) {
  if (!result.done) { message(`That performer isn’t credited in both movies. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'guess' : 'guesses'} left.`); clearGuess(); return; }
  const answer = result.answers.find(actor => actor.id === selected?.id) || result.answers[0];
  renderChain(answer);
  if (result.correct) { score += result.points; wins++; message(`You found the link! ${answer.name} connects both movies. +${result.points} points.`); }
  else message(`The missing link was ${answer.name}. Try the next round!`);
  $('game-score').textContent = score; $('game-wins').textContent = wins;
  $('guess-form').hidden = true; $('game-hint').hidden = true; $('game-reveal').hidden = true;
  $('next-round').textContent = 'Next round ↗';
  clearGuess();
}
$('guess-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !round) return;
  if (!selected) { message('Choose your performer from the name suggestions first.'); clearTimeout(timer); await lookup(); return; }
  lock(true);
  try { finish(await api({ action: 'guess', id: round.id, actorId: selected.id })); } catch (error) { message(error.message); } finally { lock(false); }
});
$('game-hint').addEventListener('click', async () => {
  if (busy || !round) return; lock(true);
  try { const result = await api({ action: 'hint', id: round.id }); message(`${result.hint} You can still earn ${result.pointsAvailable} points.`); $('game-hint').hidden = true; } catch (error) { message(error.message); } finally { lock(false); }
});
$('game-reveal').addEventListener('click', async () => {
  if (busy || !round) return; lock(true);
  try { finish(await api({ action: 'reveal', id: round.id })); } catch (error) { message(error.message); } finally { lock(false); }
});
$('next-round').addEventListener('click', start);
