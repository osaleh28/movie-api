export function filterMovies(movies, query, genre = '') {
  const search = query.trim().normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  return movies.filter(movie => {
    const title = movie.title.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    return title.includes(search) && (!genre || movie.genres.includes(genre));
  });
}

export function imdbUrl(id) {
  return /^tt\d+$/.test(String(id)) ? `https://www.imdb.com/title/${id}/` : null;
}
