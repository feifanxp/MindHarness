import type {
  ThreadFilterKey,
  ThreadFilterState,
  TriState,
} from './roomThreadOverviewModel';

const STATUS_KEYS: ThreadFilterKey[] = ['resolved', 'streaming', 'scheduled', 'unread', 'idle'];
const TAG_NAME = /^[a-z0-9-]{1,50}$/;
const isOrToken = (token: string) => token.toLowerCase() === 'or';
const stripNegation = (token: string) => (token.startsWith('-') ? token.slice(1) : token);
const looksLikeDslToken = (token: string) => {
  const lowered = stripNegation(token).toLowerCase();
  return lowered.startsWith('is:') || lowered.startsWith('tag:');
};

export type ParsedThreadFilterQuery = {
  status: Partial<Record<ThreadFilterKey, TriState>>;
  tags: Map<string, TriState>;
  statusMode: 'and' | 'or';
  freeText: string;
  unsupportedTail: string;
};

type ParsedAtom =
  | { kind: 'status'; key: ThreadFilterKey; state: TriState }
  | { kind: 'tag'; key: string; state: TriState };

const parseAtom = (token: string): ParsedAtom | null => {
  const state: TriState = token.startsWith('-') ? 'exclude' : 'include';
  const body = stripNegation(token);
  const lowered = body.toLowerCase();
  if (lowered.startsWith('is:')) {
    const key = lowered.slice(3) as ThreadFilterKey;
    return STATUS_KEYS.includes(key) ? { kind: 'status', key, state } : null;
  }
  if (!body.startsWith('tag:')) return null;
  const key = body.slice(4);
  return TAG_NAME.test(key) ? { kind: 'tag', key, state } : null;
};

export const parseThreadFilterQuery = (text: string): ParsedThreadFilterQuery => {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const status: ParsedThreadFilterQuery['status'] = {};
  const tags = new Map<string, TriState>();
  const freeText: string[] = [];
  const unsupported: string[] = [];
  let statusMode: 'and' | 'or' = 'and';

  for (let i = 0; i < tokens.length; ) {
    if (i + 1 < tokens.length && isOrToken(tokens[i + 1])) {
      let end = i;
      while (end + 2 < tokens.length && isOrToken(tokens[end + 1])) end += 2;
      if (end === i) end = Math.min(i + 1, tokens.length - 1);
      const run = tokens.slice(i, end + 1);
      const atoms = run.filter((_, index) => index % 2 === 0).map(parseAtom);
      const validOrRun =
        run.length >= 3 &&
        run.every((token, index) => index % 2 === 0 || isOrToken(token)) &&
        atoms.every((atom) => atom?.kind === 'status' && atom.state === 'include') &&
        statusMode !== 'or';
      if (validOrRun) {
        atoms.forEach((atom) => {
          status[(atom as Extract<ParsedAtom, { kind: 'status' }>).key] = 'include';
        });
        statusMode = 'or';
      } else {
        unsupported.push(run.join(' '));
      }
      i = end + 1;
      continue;
    }

    const atom = parseAtom(tokens[i]);
    if (atom?.kind === 'status') status[atom.key] = atom.state;
    else if (atom?.kind === 'tag') tags.set(atom.key, atom.state);
    else if (isOrToken(tokens[i]) || looksLikeDslToken(tokens[i])) unsupported.push(tokens[i]);
    else freeText.push(tokens[i]);
    i += 1;
  }

  return {
    status,
    tags,
    statusMode,
    freeText: freeText.join(' '),
    unsupportedTail: unsupported.join(' '),
  };
};

export const applyParsedThreadFilterQuery = (
  state: ThreadFilterState,
  parsed: ParsedThreadFilterQuery
): ThreadFilterState => {
  const next = { ...state, tags: new Map(parsed.tags) } as ThreadFilterState;
  STATUS_KEYS.forEach((key) => {
    next[key] = parsed.status[key] ?? 'any';
  });
  next.statusMode = parsed.statusMode;
  next.freeText = parsed.freeText;
  next.unsupportedQuery = parsed.unsupportedTail;
  return next;
};

export const serializeThreadFilterQuery = (state: ThreadFilterState): string => {
  const statuses = (triState: TriState, prefix: 'is:' | '-is:') =>
    STATUS_KEYS.filter((key) => state[key] === triState).map((key) => `${prefix}${key}`);
  const tags = [...state.tags.entries()].sort(([left], [right]) => left.localeCompare(right));
  const positives = statuses('include', 'is:');
  const negatives = statuses('exclude', '-is:');
  const positiveTags = tags
    .filter(([, value]) => value === 'include')
    .map(([key]) => `tag:${key}`);
  const negativeTags = tags
    .filter(([, value]) => value === 'exclude')
    .map(([key]) => `-tag:${key}`);

  return [
    state.statusMode === 'or' && positives.length > 1
      ? positives.join(' OR ')
      : positives.join(' '),
    negatives.join(' '),
    positiveTags.join(' '),
    negativeTags.join(' '),
    state.freeText ?? '',
    state.unsupportedQuery ?? '',
  ]
    .filter(Boolean)
    .join(' ');
};
