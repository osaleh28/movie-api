# Reel

A movie cast connection game for actors and actresses. Two stars and two movies form a chain with one missing performer. Guess someone credited in both movies to solve the round.

## Run locally

Requires Node.js 22 or newer. No dependencies or API key are needed.

```sh
npm start
```

Open http://localhost:3000. Use `npm run dev` to restart automatically during development and `npm test` to run the tests. Set `PORT` or `HOST` to change the server address.

## Play

- Click **Start playing**, then type the missing performer's name and choose them from the suggestions.
- Each round allows three guesses. A correct first guess earns 100 points. Each previous wrong guess and the optional hint deducts 25 points.
- Reveal the answer or skip to move on. Play through 26 distinct challenges before they repeat, including Chris Pratt → Jurassic World Dominion → Jeff Goldblum → Independence Day → Will Smith. The collection includes actors and actresses across action films, comedies, dramas, and fantasy. Refreshing the page starts the collection over.
- Any performer credited in both movies is accepted, excluding the two endpoints. Answers and scoring stay on the server until the round ends. Points and solved counts last for the current page session; refreshing resets them.
- **Explore your own actor connection** lets you search any two actors or actresses and discover a chain of up to six movie links.

## Data

[Wikidata](https://www.wikidata.org/) supplies actor names and movie cast credits through its public Action API and SPARQL endpoint. Movie links are source records. Community credits may be incomplete, and requests can fail or be rate limited. Search has a 45-second timeout and bounded exploration, so an unsuccessful search does not prove that no connection exists. Game rounds expire after an hour; completed data is cached for 30 minutes. There is no movie catalog.

The Node server serves the frontend and proxies requests. `POST /api/game` starts rounds and handles guesses, hints, and reveals. `GET /api/actors?name=...` returns up to eight people with a non-deprecated acting occupation in Wikidata, including specialized occupations such as voice acting through the occupation hierarchy. People without a recorded acting occupation are excluded. `GET /api/connections?from=Q...&to=Q...` finds chains. No secrets are sent to the browser.
