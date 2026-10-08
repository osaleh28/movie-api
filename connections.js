// Bidirectional breadth-first search. Every edge represents a shared movie cast.
export async function findConnection(from, to, neighbors, options = {}) {
  const { maxDepth = 6, maxExpanded = 80, maxNodes = 6000, batchSize = 8, maxAlternatives = 50, signal } = options;
  if (from.id === to.id) return { status: 'found', actors: [from], movies: [], sharedMovies: [], limited: false, expanded: 0 };
  const left = { seen: new Map([[from.id, { actor: from, parent: null }]]), frontier: [from.id], depth: 0 };
  const right = { seen: new Map([[to.id, { actor: to, parent: null }]]), frontier: [to.id], depth: 0 };
  let expanded = 0;
  let limited = false;
  const build = meeting => {
    const walk = side => {
      const actors = [], movies = [], sharedMovies = [];
      let node = side.seen.get(meeting);
      while (node) {
        actors.push(node.actor);
        if (node.parent === null) break;
        movies.push(node.movie);
        sharedMovies.push(node.sharedMovies);
        node = side.seen.get(node.parent);
      }
      return { actors, movies, sharedMovies };
    };
    const a = walk(left), b = walk(right);
    return { status: 'found', actors: [...a.actors.reverse(), ...b.actors.slice(1)], movies: [...a.movies.reverse(), ...b.movies], sharedMovies: [...a.sharedMovies.reverse(), ...b.sharedMovies], limited, expanded };
  };
  while (left.frontier.length && right.frontier.length && left.depth + right.depth < maxDepth) {
    signal?.throwIfAborted();
    const side = left.frontier.length <= right.frontier.length ? left : right;
    const other = side === left ? right : left;
    const next = [];
    let bestMeetings = new Set();
    let bestLength = Infinity;
    for (let offset = 0; offset < side.frontier.length; offset += batchSize) {
      signal?.throwIfAborted();
      const allowance = maxExpanded - expanded;
      if (allowance <= 0) { limited = true; break; }
      const ids = side.frontier.slice(offset, offset + Math.min(batchSize, allowance));
      const result = await neighbors(ids, signal);
      signal?.throwIfAborted();
      expanded += ids.length;
      limited ||= Boolean(result.truncated);
      const origins = new Set(ids);
      for (const edge of result.edges) {
        if (!origins.has(edge.originId) || !edge.actor?.id || !edge.movie?.id) continue;
        const depth = side.depth + 1;
        const existing = side.seen.get(edge.actor.id);
        if (!existing) {
          if (side.seen.size + other.seen.size >= maxNodes) { limited = true; continue; }
          side.seen.set(edge.actor.id, { actor: edge.actor, parent: edge.originId, movie: edge.movie, sharedMovies: edge.movies || [edge.movie], depth });
          next.push(edge.actor.id);
        }
        if (other.seen.has(edge.actor.id)) {
          const length = (side.seen.get(edge.actor.id).depth || 0) + (other.seen.get(edge.actor.id).depth || 0);
          if (length < bestLength) {
            bestMeetings = new Set([edge.actor.id]);
            bestLength = length;
          } else if (length === bestLength) bestMeetings.add(edge.actor.id);
        }
      }
      if (ids.length < Math.min(batchSize, side.frontier.length - offset)) limited = true;
    }
    side.depth++;
    side.frontier = next;
    if (bestMeetings.size) {
      const paths = new Map();
      for (const meeting of bestMeetings) {
        const path = build(meeting);
        paths.set(path.actors.map(actor => actor.id).join(':'), path);
      }
      const alternatives = [...paths.values()].slice(0, maxAlternatives).map(({ actors, movies, sharedMovies }) => ({ actors, movies, sharedMovies }));
      return { ...build(bestMeetings.values().next().value), alternatives, alternativesLimited: paths.size > maxAlternatives };
    }
    if (limited) return { status: 'limit', limited: true, expanded, maxDepth };
  }
  return { status: 'not-found', limited: false, expanded, maxDepth };
}
