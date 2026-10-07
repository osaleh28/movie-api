// Bidirectional breadth-first search. Every edge represents a shared movie cast.
export async function findConnection(from, to, neighbors, options = {}) {
  const { maxDepth = 6, maxExpanded = 80, maxNodes = 6000, batchSize = 8, signal } = options;
  if (from.id === to.id) return { status: 'found', actors: [from], movies: [], limited: false, expanded: 0 };
  const left = { seen: new Map([[from.id, { actor: from, parent: null }]]), frontier: [from.id], depth: 0 };
  const right = { seen: new Map([[to.id, { actor: to, parent: null }]]), frontier: [to.id], depth: 0 };
  let expanded = 0;
  let limited = false;
  const build = meeting => {
    const walk = side => {
      const actors = [], movies = [];
      let node = side.seen.get(meeting);
      while (node) {
        actors.push(node.actor);
        if (node.parent === null) break;
        movies.push(node.movie);
        node = side.seen.get(node.parent);
      }
      return { actors, movies };
    };
    const a = walk(left), b = walk(right);
    return { status: 'found', actors: [...a.actors.reverse(), ...b.actors.slice(1)], movies: [...a.movies.reverse(), ...b.movies], limited, expanded };
  };
  while (left.frontier.length && right.frontier.length && left.depth + right.depth < maxDepth) {
    signal?.throwIfAborted();
    const side = left.frontier.length <= right.frontier.length ? left : right;
    const other = side === left ? right : left;
    const next = [];
    let bestMeeting;
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
        if (!side.seen.has(edge.actor.id)) {
          if (side.seen.size + other.seen.size >= maxNodes) { limited = true; continue; }
          side.seen.set(edge.actor.id, { actor: edge.actor, parent: edge.originId, movie: edge.movie, depth: side.depth + 1 });
          next.push(edge.actor.id);
        }
        if (other.seen.has(edge.actor.id)) {
          const length = (side.seen.get(edge.actor.id).depth || 0) + (other.seen.get(edge.actor.id).depth || 0);
          if (length < bestLength) { bestMeeting = edge.actor.id; bestLength = length; }
        }
      }
      if (ids.length < Math.min(batchSize, side.frontier.length - offset)) limited = true;
    }
    side.depth++;
    side.frontier = next;
    if (bestMeeting) return build(bestMeeting);
    if (limited) return { status: 'limit', limited: true, expanded, maxDepth };
  }
  return { status: 'not-found', limited: false, expanded, maxDepth };
}
