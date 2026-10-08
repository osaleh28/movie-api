import { randomUUID } from 'node:crypto';
import { validId } from './wikidata.js';

export const challenges = [
  ['Q503706', 'Q40096', 'Q55178974', 'Q105387'],
  ['Q873', 'Q36949', 'Q223316', 'Q18151084'],
  ['Q2263', 'Q186485', 'Q107167', 'Q471169'],
  ['Q147077', 'Q216221', 'Q20856802', 'Q19850715'],
  ['Q38119', 'Q168724', 'Q102235', 'Q190588'],
  // Leonardo DiCaprio / Christian Bale — Inception / The Dark Knight Rises
  ['Q38111', 'Q45772', 'Q25188', 'Q189330'],
  // Tom Cruise / Ben Affleck — Ghost Protocol / The Town
  ['Q37079', 'Q483118', 'Q628154', 'Q725539'],
  // Brad Pitt / Anne Hathaway — Ocean's Eleven / Interstellar
  ['Q35332', 'Q36301', 'Q205447', 'Q13417189'],
  // Julia Roberts / Renée Zellweger — Pretty Woman / Chicago
  ['Q40523', 'Q122614', 'Q207954', 'Q189889'],
  // Johnny Depp / Elijah Wood — The Curse of the Black Pearl / Fellowship
  ['Q37175', 'Q483771', 'Q46717', 'Q127367'],
  // Keanu Reeves / Guy Pearce — The Matrix / Memento
  ['Q43416', 'Q223745', 'Q83495', 'Q190525'],
  // Harrison Ford / Elijah Wood — Raiders of the Lost Ark / Fellowship
  ['Q81328', 'Q483771', 'Q174284', 'Q127367'],
  // Jennifer Lawrence / Anna Kendrick — The Hunger Games / Pitch Perfect
  ['Q189490', 'Q67701', 'Q212965', 'Q137584'],
  // Chris Evans / Brie Larson — The Avengers / Kong: Skull Island
  ['Q178348', 'Q29328', 'Q182218', 'Q21203766'],
  // Natalie Portman / Mark Ruffalo — Thor / The Avengers
  ['Q37876', 'Q41422', 'Q217020', 'Q182218'],
  // Reese Witherspoon / Ron Perlman — Legally Blonde / Hellboy
  ['Q44063', 'Q220698', 'Q500093', 'Q461540'],
  // Benedict Cumberbatch / Hugh Grant — The Imitation Game / Love Actually
  ['Q244674', 'Q163286', 'Q14918344', 'Q190588'],
  // Ed Skrein / Helen Mirren — Deadpool / Woman in Gold
  ['Q5335413', 'Q349391', 'Q19347291', 'Q17184103'],
  // Jennifer Aniston / Leonardo DiCaprio — Horrible Bosses / Django Unchained
  ['Q32522', 'Q38111', 'Q908556', 'Q571032'],
  // Kate Winslet / Tom Hardy — Titanic / The Revenant
  ['Q202765', 'Q208026', 'Q44578', 'Q18002795'],
  // Jim Carrey / Rachel McAdams — Eternal Sunshine / Spotlight
  ['Q40504', 'Q190386', 'Q208269', 'Q18154496'],
  // Samuel L. Jackson / Saoirse Ronan — Pulp Fiction / The Grand Budapest Hotel
  ['Q172678', 'Q228603', 'Q104123', 'Q3521099'],
  // Uma Thurman / Salma Hayek — Pulp Fiction / From Dusk till Dawn
  ['Q125017', 'Q125106', 'Q104123', 'Q196004'],
  // Al Pacino / Tom Cruise — Heat / Top Gun
  ['Q41163', 'Q37079', 'Q42198', 'Q110138'],
  // Leonardo DiCaprio / Mila Kunis — The Departed / Ted
  ['Q38111', 'Q37628', 'Q172975', 'Q641760'],
  // Jodie Foster / Edward Norton — The Silence of the Lambs / Red Dragon
  ['Q41351', 'Q125904', 'Q133654', 'Q9125658'],
];

export function createGame(data, seeds = challenges) {
  const rounds = new Map();
  async function start(index = 0) {
    const seed = seeds[((index % seeds.length) + seeds.length) % seeds.length];
    const { from, to, movies: [first, second] } = await data.roundCredits(seed);
    if (!first.cast.includes(from.id) || !second.cast.includes(to.id)) throw new Error('This round’s cast credits are incomplete. Try another round.');
    const answers = first.cast.filter(id => second.cast.includes(id) && id !== from.id && id !== to.id);
    if (!answers.length) throw new Error('This round has no verified connection. Try another round.');
    const people = await data.people(answers, undefined, { skipExcluded: true });
    if (!people.length) throw new Error('This round has no eligible connection. Try another round.');
    for (const [id, round] of rounds) if (Date.now() - round.created > 3600000) rounds.delete(id);
    if (rounds.size >= 200) rounds.delete(rounds.keys().next().value);
    const id = randomUUID();
    rounds.set(id, { answers: people, attempts: 0, guessed: new Set(), hinted: false, done: false, created: Date.now() });
    const movie = ({ id, title, year }) => ({ id, title, year });
    return { id, from, to, movies: [movie(first), movie(second)], maxAttempts: 3 };
  }
  function act(id, action, actorId) {
    const round = rounds.get(id);
    if (!round || Date.now() - round.created > 3600000) throw new Error('Round expired. Start a new round.');
    if (round.done) throw new Error('This round is finished. Start a new round.');
    if (action === 'hint') {
      const scoreDelta = round.hinted ? 0 : -25;
      round.hinted = true;
      return { hint: `One answer’s initials: ${round.answers[0].name.split(/\s+/).map(word => word[0]).join('. ')}.`, pointsAvailable: Math.max(10, 100 - round.attempts * 25 - 25), scoreDelta };
    }
    if (action === 'reveal') {
      round.done = true;
      return { done: true, correct: false, points: 0, scoreDelta: 0, answers: round.answers };
    }
    if (action !== 'guess' || !validId(actorId)) throw new Error('Choose an actor from the suggestions.');
    if (round.guessed.has(actorId)) throw new Error('You already tried that performer. Choose someone else.');
    round.guessed.add(actorId);
    round.attempts++;
    const correct = round.answers.some(person => person.id === actorId);
    round.done = correct || round.attempts >= 3;
    return { correct, done: round.done, attemptsLeft: 3 - round.attempts, points: correct ? Math.max(10, 100 - (round.attempts - 1) * 25 - (round.hinted ? 25 : 0)) : 0, scoreDelta: correct ? 100 : -25, ...(round.done ? { answers: round.answers } : {}) };
  }
  return { start, act };
}
