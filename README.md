# Reel Connections

A movie cast connection game for actors and actresses. Two stars and two movies form a chain with one missing performer. Guess someone credited in both movies to solve the round.

## Run locally

Requires Node.js 22 or newer. No dependencies or API key are needed.

```sh
npm start
```

Open http://localhost:3000. Use `npm run dev` to restart automatically during development and `npm test` to run the tests. Set `PORT` or `HOST` to change the server address.

You can also use this link: [movie-api-1-2cr6.onrender.com/](https://movie-api-1-2cr6.onrender.com/)

## Play

- Click **Start playing**, then type the missing performer's name and choose them from the suggestions.
- Each round allows three guesses. A correct guess adds 100 points. Each wrong guess, the optional hint, and revealing the answer before the round ends immediately deducts 25 from the running score, which can go below zero. Penalties are charged once and are not charged again when you solve the round. Skipping adds no points and leaves any deductions in place.
- Reveal the answer or skip to move on. Play through 26 distinct challenges in random order before they repeat, including Chris Pratt → Jurassic World Dominion → Jeff Goldblum → Independence Day → Will Smith. The collection includes actors and actresses across action films, comedies, dramas, and fantasy. Your browser remembers played challenges across refreshes. After the collection is completed, a new random cycle begins without immediately repeating the last puzzle.
- Any performer credited in both movies is accepted, excluding the two endpoints. Answers and scoring stay on the server until the round ends. Points and solved counts last for the current page session; refreshing resets them.
- **Explore your own actor connection** lets you search any two actors or actresses and discover a chain without a fixed movie-link cap. Shorter chains are searched first. Each link lists all shared movies found for that pair, with release years and source links. Multiple shared movies between two people count as one link. The request timeout and exploration limits still apply, and Wikidata credits can be incomplete.
- Click **Find connection** again for the same pair to cycle through different shortest chains found in the search, without repeating until the list wraps around. A counter shows your place. Up to 50 distinct chains are kept; additional or longer connections may exist. Results are reused for 30 minutes, and refreshing the page resets the cycle. No actor receives a special preference.

## Data

[Wikidata](https://www.wikidata.org/) supplies actor names and movie cast credits through its public Action API and SPARQL endpoint. Movie links are source records. Community credits may be incomplete, and requests can fail or be rate limited. Search has a 45-second timeout and bounded exploration, so an unsuccessful search does not prove that no connection exists. Game rounds expire after an hour; completed data is cached for 30 minutes. There is no movie catalog.

The Node server serves the frontend and proxies requests. `POST /api/game` starts rounds and handles guesses, hints, and reveals. `GET /api/actors?name=...` returns up to eight people with a non-deprecated acting occupation in Wikidata, including specialized occupations such as voice acting through the occupation hierarchy. People without a recorded acting occupation are excluded. Pornographic performers and erotic photography models are excluded using recorded occupations and their subclasses, with descriptions as an additional check. The same exclusions apply when loading connection performers and game answers. Missing or inaccurate Wikidata classifications can affect filtering. `GET /api/connections?from=Q...&to=Q...` finds chains. No secrets are sent to the browser.
