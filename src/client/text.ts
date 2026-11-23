import type { LogEntry } from '../engine';

export interface Viewer {
  id: string;
  name: string;
}

/** Third-person verbs the engine uses, and their second-person form. */
const SECOND_PERSON: Record<string, string> = {
  posts: 'post', folds: 'fold', checks: 'check', calls: 'call', bets: 'bet', raises: 'raise',
  wins: 'win', shows: 'show', is: 'are',
};

/**
 * Rewrite a log line about the viewer in the second person, so the viewer reads
 * "You call £10" and "You are eliminated" instead of "You calls £10" / "Sam is eliminated".
 */
export function logText(entry: LogEntry, me: Viewer | null): string {
  if (!me || entry.playerId !== me.id) return entry.text;
  const prefix = `${me.name} `;
  if (entry.text.startsWith(prefix)) {
    const rest = entry.text.slice(prefix.length);
    const [verb, ...tail] = rest.split(' ');
    const fixed = SECOND_PERSON[verb];
    if (fixed) return ['You', fixed, ...tail].join(' ');
  }
  if (entry.kind === 'uncalled' && entry.text.endsWith(` returned to ${me.name}`)) {
    return entry.text.slice(0, -me.name.length) + 'you';
  }
  return entry.text;
}

/** Display name for a player: "You" for the viewer. */
export function nameFor(id: string, name: string, me: Viewer | null): string {
  return me && id === me.id ? 'You' : name;
}

/** "You win" / "Sam wins" — picks the verb form for the subject. */
export function verb(id: string, me: Viewer | null, thirdPerson: string, secondPerson: string): string {
  return me && id === me.id ? secondPerson : thirdPerson;
}
