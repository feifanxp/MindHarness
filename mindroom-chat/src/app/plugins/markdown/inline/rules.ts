import { execOutsideUrl } from '../../../utils/regex';
import { sanitizeText } from '../../../utils/sanitize';
import { findInlineLatexMatch } from '../../math';
import { InlineMDRule } from './type';

const MIN_ANY = '(.+?)';
const ESC_NEG_LB = '(?<!\\\\)';

const BOLD_MD_1 = '**';
const BOLD_PREFIX_1 = `${ESC_NEG_LB}\\*{2}`;
const BOLD_NEG_LA_1 = '(?!\\*)';
const BOLD_REG_1 = new RegExp(`${BOLD_PREFIX_1}${MIN_ANY}${BOLD_PREFIX_1}${BOLD_NEG_LA_1}`, 'g');
export const BoldRule: InlineMDRule = {
  match: (text) => execOutsideUrl(BOLD_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<strong data-md="${BOLD_MD_1}">${parse(g1)}</strong>`;
  },
};

const ITALIC_MD_1 = '*';
const ITALIC_PREFIX_1 = `${ESC_NEG_LB}\\*`;
const ITALIC_NEG_LA_1 = '(?!\\*)';
const ITALIC_REG_1 = new RegExp(
  `${ITALIC_PREFIX_1}${MIN_ANY}${ITALIC_PREFIX_1}${ITALIC_NEG_LA_1}`,
  'g'
);
export const ItalicRule1: InlineMDRule = {
  match: (text) => execOutsideUrl(ITALIC_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<i data-md="${ITALIC_MD_1}">${parse(g1)}</i>`;
  },
};

const ITALIC_MD_2 = '_';
const ITALIC_PREFIX_2 = `${ESC_NEG_LB}_`;
const ITALIC_NEG_LA_2 = '(?!_)';
const ITALIC_REG_2 = new RegExp(
  `${ITALIC_PREFIX_2}${MIN_ANY}${ITALIC_PREFIX_2}${ITALIC_NEG_LA_2}`,
  'g'
);
export const ItalicRule2: InlineMDRule = {
  match: (text) => execOutsideUrl(ITALIC_REG_2, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<i data-md="${ITALIC_MD_2}">${parse(g1)}</i>`;
  },
};

const UNDERLINE_MD_1 = '__';
const UNDERLINE_PREFIX_1 = `${ESC_NEG_LB}_{2}`;
const UNDERLINE_NEG_LA_1 = '(?!_)';
const UNDERLINE_REG_1 = new RegExp(
  `${UNDERLINE_PREFIX_1}${MIN_ANY}${UNDERLINE_PREFIX_1}${UNDERLINE_NEG_LA_1}`,
  'g'
);
export const UnderlineRule: InlineMDRule = {
  match: (text) => execOutsideUrl(UNDERLINE_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<u data-md="${UNDERLINE_MD_1}">${parse(g1)}</u>`;
  },
};

const STRIKE_MD_1 = '~~';
const STRIKE_PREFIX_1 = `${ESC_NEG_LB}~{2}`;
const STRIKE_NEG_LA_1 = '(?!~)';
const STRIKE_REG_1 = new RegExp(
  `${STRIKE_PREFIX_1}${MIN_ANY}${STRIKE_PREFIX_1}${STRIKE_NEG_LA_1}`,
  'g'
);
export const StrikeRule: InlineMDRule = {
  match: (text) => execOutsideUrl(STRIKE_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<s data-md="${STRIKE_MD_1}">${parse(g1)}</s>`;
  },
};

const CODE_MD_1 = '`';
const CODE_PREFIX_1 = `${ESC_NEG_LB}\``;
const CODE_NEG_LA_1 = '(?!`)';
const CODE_REG_1 = new RegExp(`${CODE_PREFIX_1}(.+?)${CODE_PREFIX_1}${CODE_NEG_LA_1}`, 'g');
export const CodeRule: InlineMDRule = {
  match: (text) => execOutsideUrl(CODE_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<code data-md="${CODE_MD_1}">${g1}</code>`;
  },
};

const createInlineRuleMatch = (
  text: string,
  fullMatch: string,
  content: string,
  index: number
): RegExpExecArray => {
  const match = [fullMatch, content] as unknown as RegExpExecArray;
  match.index = index;
  match.input = text;
  return match;
};

export const InlineMathRule: InlineMDRule = {
  match: (text) => {
    const match = findInlineLatexMatch(text);
    if (!match) return null;

    return createInlineRuleMatch(text, match.fullMatch, match.latex, match.start);
  },
  html: (_parse, match) => {
    const [, g1] = match;
    const latex = sanitizeText(g1);
    return `<span data-mx-maths="${latex}">${latex}</span>`;
  },
};

const SPOILER_MD_1 = '||';
const SPOILER_PREFIX_1 = `${ESC_NEG_LB}\\|{2}`;
const SPOILER_NEG_LA_1 = '(?!\\|)';
const SPOILER_REG_1 = new RegExp(
  `${SPOILER_PREFIX_1}${MIN_ANY}${SPOILER_PREFIX_1}${SPOILER_NEG_LA_1}`,
  'g'
);
export const SpoilerRule: InlineMDRule = {
  match: (text) => execOutsideUrl(SPOILER_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return `<span data-md="${SPOILER_MD_1}" data-mx-spoiler>${parse(g1)}</span>`;
  },
};

const LINK_ALT = `\\[${MIN_ANY}\\]`;
const LINK_URL = `\\((https?:\\/\\/.+?)\\)`;
const LINK_REG_1 = new RegExp(`${LINK_ALT}${LINK_URL}`);
export const LinkRule: InlineMDRule = {
  match: (text) => text.match(LINK_REG_1),
  html: (parse, match) => {
    const [, g1, g2] = match;
    return `<a data-md href="${g2}">${parse(g1)}</a>`;
  },
};

export const INLINE_SEQUENCE_SET = '[*_~`|$]';
const ESC_SEQ_1 = `\\\\(${INLINE_SEQUENCE_SET})`;
const ESC_REG_1 = new RegExp(ESC_SEQ_1, 'g');
export const EscapeRule: InlineMDRule = {
  match: (text) => execOutsideUrl(ESC_REG_1, text),
  html: (parse, match) => {
    const [, g1] = match;
    return g1;
  },
};
