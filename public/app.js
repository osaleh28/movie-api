import { filterMovies, imdbUrl } from './movies.js';

const search = document.querySelector('#search');
const genre = document.querySelector('#genre');
const grid = document.querySelector('#movies');
const message = document.querySelector('#message');
const warning = document.querySelector('#warning');
const reload = document.querySelector('#reload');
const more = document.querySelector('#more');
const showing = document.querySelector('#showing');
const title = document.querySelector('#results-title');
const meta = document.querySelector('#catalog-meta');
const template = document.querySelector('#movie-template');
let movies = [];
let limit = 24;
let ready = false;
let controller;

function render() {
  if (!ready) return;
  const filtered = filterMovies(movies, search.value, genre.value);
  const visible = filtered.slice(0, limit);
  title.textContent = search.value.trim() ? `Results for “${search.value.trim()}”` : genre.value || 'Browse the collection';
  meta.textContent = `${filtered.length} ${filtered.length === 1 ? 'FILM' : 'FILMS'} / THE COLLECTION`;
  message.hidden = visible.length > 0;
  message.textContent = movies.length ? 'No films match your search in this catalog. Try another title or choose All genres.' : 'The catalog is empty right now. Try Reload catalog shortly.';
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  visible.forEach((movie, index) => {
    const card = template.content.cloneNode(true);
    card.querySelector('.movie-title').textContent = movie.title;
    card.querySelector('.movie-genres').textContent = movie.genres.join(' / ');
    card.querySelector('.poster-number').textContent = String(index + 1).padStart(2, '0');
    const url = imdbUrl(movie.imdbId);
    const link = card.querySelector('.movie-link');
    if (url) link.href = url;
    else link.remove();
    if (typeof movie.poster === 'string' && movie.poster.startsWith('https://')) {
      const image = document.createElement('img');
      image.alt = `${movie.title} poster`;
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.className = 'loading-poster';
      image.addEventListener('load', () => image.classList.remove('loading-poster'));
      image.addEventListener('error', () => image.remove());
      image.src = movie.poster;
      card.querySelector('.poster').append(image);
    }
    fragment.append(card);
  });
  grid.append(fragment);
  showing.textContent = filtered.length ? `Showing ${visible.length} of ${filtered.length} films` : '';
  more.hidden = visible.length >= filtered.length;
}

async function loadCatalog() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  ready = false;
  reload.disabled = true;
  grid.setAttribute('aria-busy', 'true');
  grid.replaceChildren();
  warning.hidden = true;
  more.hidden = true;
  showing.textContent = '';
  message.hidden = false;
  message.textContent = 'Loading the movie catalog…';
  for (let i = 0; i < 8; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    grid.append(skeleton);
  }
  try {
    const response = await fetch('/api/movies', { signal: current.signal });
    const payload = await response.json();
    if (current.signal.aborted) return;
    if (!response.ok) throw new Error(payload.error || 'Could not load movies. Please try again.');
    if (!Array.isArray(payload.movies)) throw new Error('Unexpected catalog response. Please try again.');
    movies = payload.movies;
    warning.textContent = payload.warning || '';
    warning.hidden = !payload.warning;
    ready = true;
    limit = 24;
    render();
  } catch (error) {
    if (current.signal.aborted) return;
    grid.replaceChildren();
    message.hidden = false;
    message.textContent = error.message === 'Failed to fetch' ? 'Could not connect. Check your connection and try Reload catalog.' : error.message;
    meta.textContent = 'CATALOG UNAVAILABLE';
  } finally {
    if (controller === current) {
      reload.disabled = false;
      grid.setAttribute('aria-busy', 'false');
    }
  }
}

const searchMovies = () => { limit = 24; render(); };
document.querySelector('#search-form').addEventListener('submit', event => { event.preventDefault(); searchMovies(); });
search.addEventListener('input', searchMovies);
genre.addEventListener('change', searchMovies);
reload.addEventListener('click', loadCatalog);
more.addEventListener('click', () => { limit += 24; render(); });
loadCatalog();
