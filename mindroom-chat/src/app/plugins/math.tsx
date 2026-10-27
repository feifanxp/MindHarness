import katex from 'katex';
import { Opts as LinkifyOpts, find as findLinks } from 'linkifyjs';

export type LatexMatch = {
  fullMatch: string;
  latex: string;
  start: number;
  end: number;
  displayMode: boolean;
};

export type LatexTextSegment =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'verbatim';
      content: string;
    }
  | {
      type: 'url';
      content: string;
    }
  | {
      type: 'math';
      content: string;
      displayMode: boolean;
    };

const hasNonWhitespaceBoundary = (text: string): boolean =>
  text.length > 0 && !/^\s/.test(text) && !/\s$/.test(text);

const ALPHANUMERIC_REG = /[0-9A-Za-z]/;

const isAlphanumeric = (value: string | undefined): boolean =>
  typeof value === 'string' && ALPHANUMERIC_REG.test(value);

const CURRENCY_AMOUNT_REG = /(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?/;
const CURRENCY_AMOUNT_START_REG = new RegExp(`^${CURRENCY_AMOUNT_REG.source}`);
const CURRENCY_UNIT_REG =
  /^(?:(?:USD|EUR|GBP|CAD|AUD|JPY|CHF|CNY|INR|BRL|MXN)\b|(?:bucks?|cents?|dollars?)\b|\/[A-Za-z][A-Za-z0-9-]*$)/i;
const CURRENCY_RANGE_REST_REG = /^[-–]\s*\\?\$?\d/;

const isCurrencyLikeLatex = (latex: string): boolean => {
  const trimmed = latex.trim();
  const amountMatch = trimmed.match(CURRENCY_AMOUNT_START_REG);
  if (!amountMatch) return false;

  const rest = trimmed.slice(amountMatch[0].length).trim();
  if (rest.length === 0) return true;

  if (CURRENCY_UNIT_REG.test(rest)) return true;
  if (CURRENCY_RANGE_REST_REG.test(rest)) return true;

  return false;
};

const isEscaped = (text: string, index: number): boolean => {
  let backslashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && text[cursor] === '\\') {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
};

const isLineStart = (text: string, index: number): boolean =>
  index === 0 || text[index - 1] === '\n';

const isLineEnd = (text: string, index: number): boolean =>
  index >= text.length || text[index] === '\n';

const normalizeDisplayLatex = (latex: string): string => {
  let normalized = latex;

  if (normalized.startsWith('\n')) normalized = normalized.slice(1);
  if (normalized.endsWith('\n')) normalized = normalized.slice(0, -1);

  return normalized;
};

const hasInlineOpeningBoundary = (text: string, index: number): boolean =>
  !isAlphanumeric(text[index - 1]);

const hasInlineClosingBoundary = (text: string, index: number): boolean =>
  !isAlphanumeric(text[index + 1]);

const getInlineLatexAt = (text: string, index: number): LatexMatch | undefined => {
  if (
    index >= text.length ||
    text[index] !== '$' ||
    isEscaped(text, index) ||
    text[index + 1] === '$' ||
    !hasInlineOpeningBoundary(text, index)
  ) {
    return undefined;
  }

  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') return undefined;
    if (text[cursor] === '`' && !isEscaped(text, cursor)) return undefined;

    if (text[cursor] === '$' && !isEscaped(text, cursor)) {
      if (
        text[cursor - 1] === '$' ||
        text[cursor + 1] === '$' ||
        !hasInlineClosingBoundary(text, cursor)
      ) {
        return undefined;
      }

      const latex = text.slice(index + 1, cursor);
      if (!hasNonWhitespaceBoundary(latex) || isCurrencyLikeLatex(latex)) return undefined;

      return {
        fullMatch: text.slice(index, cursor + 1),
        latex,
        start: index,
        end: cursor + 1,
        displayMode: false,
      };
    }
  }

  return undefined;
};

type LinkSpan = ReturnType<typeof findLinks>[number];

const getUrlMatches = (text: string, linkifyOpts?: LinkifyOpts): LinkSpan[] =>
  findLinks(text, linkifyOpts).filter((match) => match.isLink && match.type === 'url');

/**
 * Returns a matcher for display math opening at a position of `text`; test positions in
 * increasing order. A scan that fails at a backtick or the end of the text passed no closing
 * `$$`, so later openers before that point fail without scanning again. Otherwise every line of
 * unclosed `$$` openers rescans the rest of the text.
 */
const createDisplayLatexMatcher = (text: string): ((index: number) => LatexMatch | undefined) => {
  let failsBefore = 0;
  return (index) => {
    if (
      index < failsBefore ||
      index + 1 >= text.length ||
      text[index] !== '$' ||
      text[index + 1] !== '$' ||
      isEscaped(text, index) ||
      !isLineStart(text, index)
    ) {
      return undefined;
    }

    for (let cursor = index + 2; cursor + 1 < text.length; cursor += 1) {
      if (text[cursor] === '`' && !isEscaped(text, cursor)) {
        failsBefore = cursor;
        return undefined;
      }

      if (
        text[cursor] === '$' &&
        text[cursor + 1] === '$' &&
        !isEscaped(text, cursor) &&
        isLineEnd(text, cursor + 2)
      ) {
        const latex = normalizeDisplayLatex(text.slice(index + 2, cursor));
        if (latex.trim().length === 0) return undefined;

        return {
          fullMatch: text.slice(index, cursor + 2),
          latex,
          start: index,
          end: cursor + 2,
          displayMode: true,
        };
      }
    }

    failsBefore = text.length;
    return undefined;
  };
};

const findCodeFenceClose = (text: string, index: number): number => {
  for (let cursor = index; cursor + 2 < text.length; cursor += 1) {
    if (
      text[cursor] === '`' &&
      text[cursor + 1] === '`' &&
      text[cursor + 2] === '`' &&
      !isEscaped(text, cursor)
    ) {
      return cursor;
    }
  }

  return -1;
};

const findInlineCodeClose = (text: string, index: number): number => {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (text[cursor] === '`' && !isEscaped(text, cursor)) {
      return cursor;
    }
  }

  return -1;
};

export const findInlineLatexMatch = (text: string): LatexMatch | undefined => {
  for (let index = 0; index < text.length; index += 1) {
    const match = getInlineLatexAt(text, index);
    if (match) return match;
  }

  return undefined;
};

export const findDisplayLatexBlockMatch = (text: string): LatexMatch | undefined => {
  const getDisplayLatexAt = createDisplayLatexMatcher(text);
  for (let index = 0; index < text.length; index += 1) {
    const match = getDisplayLatexAt(index);
    if (match) return match;
  }

  return undefined;
};

export const tokenizeTextWithLatex = (
  text: string,
  linkifyOpts?: LinkifyOpts
): LatexTextSegment[] => {
  const segments: LatexTextSegment[] = [];
  const urlMatches = getUrlMatches(text, linkifyOpts);
  const getDisplayLatexAt = createDisplayLatexMatcher(text);
  let textStart = 0;
  let index = 0;
  let urlMatchIndex = 0;

  const pushText = (end: number) => {
    if (end <= textStart) return;

    segments.push({
      type: 'text',
      content: text.slice(textStart, end),
    });
  };

  const pushVerbatim = (start: number, end: number) => {
    segments.push({
      type: 'verbatim',
      content: text.slice(start, end),
    });
  };

  const pushUrl = (start: number, end: number) => {
    segments.push({
      type: 'url',
      content: text.slice(start, end),
    });
  };

  while (index < text.length) {
    while (urlMatchIndex < urlMatches.length && urlMatches[urlMatchIndex].end <= index) {
      urlMatchIndex += 1;
    }

    if (
      text[index] === '`' &&
      text[index + 1] === '`' &&
      text[index + 2] === '`' &&
      !isEscaped(text, index)
    ) {
      const fenceClose = findCodeFenceClose(text, index + 3);
      if (fenceClose === -1) break;

      pushText(index);
      pushVerbatim(index, fenceClose + 3);
      index = fenceClose + 3;
      textStart = index;
      continue;
    }

    if (text[index] === '`' && !isEscaped(text, index)) {
      const codeClose = findInlineCodeClose(text, index + 1);
      if (codeClose === -1) break;

      pushText(index);
      pushVerbatim(index, codeClose + 1);
      index = codeClose + 1;
      textStart = index;
      continue;
    }

    const urlMatch = urlMatches[urlMatchIndex];
    if (urlMatch && urlMatch.start === index) {
      pushText(index);
      pushUrl(urlMatch.start, urlMatch.end);
      index = urlMatch.end;
      textStart = index;
      urlMatchIndex += 1;
      continue;
    }

    const displayMatch = getDisplayLatexAt(index);
    if (displayMatch) {
      pushText(displayMatch.start);
      segments.push({
        type: 'math',
        content: displayMatch.latex,
        displayMode: true,
      });

      index = displayMatch.end;
      textStart = index;
      continue;
    }

    const inlineMatch = getInlineLatexAt(text, index);
    if (inlineMatch) {
      pushText(inlineMatch.start);
      segments.push({
        type: 'math',
        content: inlineMatch.latex,
        displayMode: false,
      });

      index = inlineMatch.end;
      textStart = index;
      continue;
    }

    index += 1;
  }

  pushText(text.length);

  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
};

export const unescapeLatexDelimiters = (text: string): string => text.replace(/\\\$/g, '$');

export function renderLatexToHtml(latex: string, displayMode: boolean): string {
  try {
    const renderedHtml = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      maxSize: 500,
      maxExpand: 1000,
      output: 'htmlAndMathml',
    });

    return renderedHtml.includes('katex-error') ? latex : renderedHtml;
  } catch {
    return latex;
  }
}
