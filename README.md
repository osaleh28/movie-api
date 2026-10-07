# Reel · Six degrees of cinema

Connect two actors or actresses through films they share. Type both names,
select the right people, and choose **Find connection**. The result alternates
performers and movies, with a count of movie links and clickable source records.
**Try Chris Pratt → Will Smith** runs a real search for the example pair.

Cast credits come from the public [Wikidata API](https://www.wikidata.org/wiki/Wikidata:Data_access),
with no API key required. A bidirectional breadth-first search explores film
cast relationships (P161), restricted to films and their subclasses. Voice cast
credits count; TV series and crew-only credits do not create links.

The engine looks for a shortest chain up to six movie links, with a 45-second
deadline, at most 80 expanded performers, 6,000 visited nodes, and 12,000 rows
per cast query. It reports limits separately from an unsuccessful search; missing
or inaccurate community credits mean this is not a guarantee of the shortest
connection in the real world. Multiple equally short paths can exist. The engine
may find a different valid two-movie connection for the example pair.

Routes: `GET /api/actors?name=Chris%20Pratt` and
`GET /api/connections?from=Q503706&to=Q40096`. IDs are validated before forming
queries. Names show descriptions to distinguish people with the same name.
Completed name and cast queries are cached for 30 minutes in a bounded cache.
Searches can be cancelled, and changes to either actor clear stale results.

## Movie catalog

A small movie search app using the public [SampleAPIs movie catalog](https://sampleapis.com/api-list/movies).
Search titles, filter by genre, browse movie posters, and open a film on IMDb for
cast, plot, ratings, and other details. Works on desktop and mobile.

## Run locally

Requires Node.js 22 or newer. No API key or dependency installation is needed.

```powershell
npm start
```

Open http://localhost:3000. Use `npm run dev` to restart the server when files
change. Run automated checks with `npm test`.

## How it works

- `GET /api/movies` fetches ten movie-genre collections from
  `https://api.sampleapis.com/movies/{genre}`. Data is cached for 15 minutes;
  concurrent requests share one fetch operation.
- Movies are deduplicated by IMDb ID (or title when an ID is missing), combining
  genre labels. Malformed rows are discarded. Only valid IMDb IDs create links.
- The browser searches the downloaded catalog locally, ignoring case and accents.
  Genre and title filters work together; results show 24 at a time with Show more.
- Loading, empty, API failure, partial catalog, and missing poster states are
  handled. Use Reload catalog to retry a failed load; successful reloads may
  reuse the server cache. Partial catalogs are cached for only one minute.
- `public/` contains the HTML, CSS, browser code, and filtering helpers.
- The server exposes only known assets and API routes, with a 15-second timeout
  for each upstream request. No credentials or arbitrary proxy URLs are used.

SampleAPIs is a limited educational catalog, not an exhaustive movie database.
Its movie records provide titles, posters, and IMDb IDs; detailed descriptions,
release dates, and ratings are available through the IMDb links, not inside this
app. Data and poster availability can change. Attribution appears in the footer.

The server binds to `127.0.0.1:3000` by default. Configure `HOST` and `PORT` if
needed. An internet connection is required for movie data and posters; the
optional Google Fonts stylesheet falls back to system fonts.
