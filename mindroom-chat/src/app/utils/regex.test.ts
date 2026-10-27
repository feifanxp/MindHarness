import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createInsideUrlTest, execOutsideUrl, JUMBO_EMOJI_REG, URL_REG } from './regex';

// The lookbehind these helpers replace; V8 evaluates it in linear time, so it is the oracle.
const FORMER_URL_LOOKBEHIND = /(?<!(https?|ftp|mailto|magnet):\/\/\S*)/y;
const followsUrlScheme = (text: string, index: number): boolean => {
  FORMER_URL_LOOKBEHIND.lastIndex = index;
  return !FORMER_URL_LOOKBEHIND.test(text);
};

const CORPUS = [
  '',
  'https://example.org/a_b',
  'see https://example.org/**a** and **b**',
  'xhttps://a*b* http://c',
  'mailto://x_y_ magnet://z ftp://f\u00a0g',
  'https:/x http:// ftp:/ :// https:// //',
  'https://a\nb https://c\td',
  'a https://b.c/✅ ✅',
];

// Deterministic pseudo-random texts of tokens that form, break and end URL schemes.
const randomTexts = (count: number): string[] => {
  const tokens = [
    'https',
    'http',
    'ftp',
    'mailto',
    'magnet',
    'x',
    '://',
    ':',
    '/',
    ' ',
    '\n',
    '\u00a0',
    '*',
    '_',
  ];
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 24 }, () => tokens[next() % tokens.length]).join('')
  );
};

describe('createInsideUrlTest', () => {
  it('matches the former URL lookbehind at every position', () => {
    const texts = [...CORPUS, ...randomTexts(500)];
    expect(texts.filter((text) => text.includes('://')).length).toBeGreaterThan(300);
    texts.forEach((text) => {
      const insideUrl = createInsideUrlTest(text);
      for (let index = 0; index <= text.length; index += 1) {
        expect(insideUrl(index), `${JSON.stringify(text)} at ${index}`).toBe(
          followsUrlScheme(text, index)
        );
      }
    });
  });

  it('answers positions tested out of order', () => {
    const text = 'a https://b.c/d e';
    const insideUrl = createInsideUrlTest(text);
    expect(insideUrl(14)).toBe(true);
    expect(insideUrl(1)).toBe(false);
    expect(insideUrl(16)).toBe(false);
    expect(insideUrl(10)).toBe(true);
  });
});

describe('execOutsideUrl', () => {
  it('returns the first match that does not start inside a URL', () => {
    const match = execOutsideUrl(/_(.+?)_/g, 'https://a.b/c_d_ e _f_');
    expect(match?.index).toBe(19);
    expect(match?.[1]).toBe('f');
  });

  it('returns null when every match starts inside a URL', () => {
    expect(execOutsideUrl(/_/g, 'https://a.b/c_d_e')).toBeNull();
    expect(execOutsideUrl(/_/g, 'https://a.b/c_d_e\n')).toBeNull();
  });

  it('does not retry every position of a URL', () => {
    // Retrying each position of the run rescans the rest of it for the closing marker.
    const text = `https://x.y/${'_'.repeat(40_000)} _a_`;
    const start = performance.now();
    expect(execOutsideUrl(/_(.+?)_(?!_)/g, text)?.index).toBe(text.length - 3);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe('JUMBO_EMOJI_REG', () => {
  it.each(['👍', '👍\uFE0F 😀', ':a:', ':party-parrot: 😀 :b_c:', Array(10).fill(':a:').join(' ')])(
    'matches %j',
    (body) => {
      expect(JUMBO_EMOJI_REG.test(body)).toBe(true);
    }
  );

  it.each(['text', ':a: text', Array(11).fill(':a:').join(' '), ':a b:', ':a:b:', ': :'])(
    'does not match %j',
    (body) => {
      expect(JUMBO_EMOJI_REG.test(body)).toBe(false);
    }
  );

  it('rejects many shortcodes followed by text without backtracking', () => {
    // A shortcode could span other shortcodes, so the ten allowed could be split among thirty
    // in millions of ways: this took seconds in V8 and JavaScriptCore.
    const start = performance.now();
    expect(JUMBO_EMOJI_REG.test(`${':rocket: :white_check_mark: :tada: '.repeat(10)}ok`)).toBe(
      false
    );
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe('URL_REG', () => {
  it('drops trailing punctuation without rescanning it at every position', () => {
    const text =
      'See https://e.org/a_(b), http://x.y/z... (https://www.q.r/?s=t!) or https://a.b/c/';
    expect(text.match(URL_REG)).toEqual([
      'https://e.org/a_(b',
      'http://x.y/z',
      'https://www.q.r/?s=t',
      'https://a.b/c',
    ]);

    // A lookbehind that repeated the punctuation class read the whole run back from every
    // position the URL could end at, so a link followed by many dots froze the timeline.
    const start = performance.now();
    expect(`http://${'.'.repeat(100_000)}`.match(URL_REG)).toBeNull();
    expect(performance.now() - start).toBeLessThan(100);
  });
});

const listSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

// A lookbehind that repeats `\S`, `\w`, `\d`, `.` or a negated class can span a whole line of
// ordinary text. JavaScriptCore rescans it at every position: parsing 3.5 kB of file paths
// through the inline Markdown rules took 12.6 s there and under 3 ms in V8.
const UNBOUNDED_LOOKBEHIND =
  /\(\?<[!=](?:[^()]|\([^()]*\))*?(?:\\{1,2}[SwWdD]|\.|\[\^[^\]]*\])(?:[*+]|\{\d+,\})/;

describe('source regexes', () => {
  it('have no lookbehind that repeats a broad character class', () => {
    const sourceDirectory = fileURLToPath(new URL('../..', import.meta.url));
    const offenders = listSources(sourceDirectory).filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => UNBOUNDED_LOOKBEHIND.test(line))
    );
    expect(offenders).toEqual([]);
  });

  it('flags lookbehinds that repeat a broad character class', () => {
    expect(UNBOUNDED_LOOKBEHIND.test("'(?<!(https?|ftp):\\\\/\\\\/\\\\S*)'")).toBe(true);
    expect(UNBOUNDED_LOOKBEHIND.test('/(?<=[^\\s]+)x/')).toBe(true);
    expect(UNBOUNDED_LOOKBEHIND.test('/(?<!a.{2,})x/')).toBe(true);
    expect(UNBOUNDED_LOOKBEHIND.test('/(?<!\\\\)\\*(.+?)\\*/')).toBe(false);
    expect(UNBOUNDED_LOOKBEHIND.test('`(?<![.,:;!/?()[\\]\\s]+)`')).toBe(false);
  });
});
