import { Element, Text as DOMText, htmlToDOM } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import {
  MINDROOM_TOOL_REF_HTML_REG_G,
  MINDROOM_TOOL_REF_ICON,
  MindroomToolRefParseResult,
  parseMindroomToolRefHtml,
} from './blocks';

// DOM-only helpers for MindRoom tool markers, shared by the renderer and by
// copy so both agree on which markers display as tool blocks.

export const isDomTextNode = (node: unknown): node is DOMText =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { data?: unknown }).data === 'string' &&
  !Array.isArray((node as { children?: unknown }).children);

export const isDomElementNode = (node: unknown): node is Element =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { name?: unknown }).name === 'string' &&
  Array.isArray((node as { children?: unknown }).children);

export const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (isDomTextNode(node)) {
      text += node.data;
    } else if (isDomElementNode(node)) {
      text += extractTextFromChildren((node as { children: ChildNode[] }).children);
    }
  });

  return text;
};

export type ToolRefElementPrefix = {
  html: string;
  trailingChildren: ChildNode[];
};

export const trimLeadingToolRefBoundary = (children: ChildNode[]): ChildNode[] => {
  const remaining = [...children];

  const trimLeadingWhitespaceText = () => {
    while (remaining.length > 0) {
      const first = remaining[0];
      if (!isDomTextNode(first) || first.data.trim()) break;
      remaining.shift();
    }
  };

  trimLeadingWhitespaceText();

  if (remaining.length > 0 && isDomElementNode(remaining[0]) && remaining[0].name === 'br') {
    remaining.shift();
    trimLeadingWhitespaceText();
  }

  return remaining;
};

export const parseToolRefIndexFromTextPrefix = (text: string): number | undefined => {
  const match = /^\s*🔧[\s\S]*?\[(\d+)\](?:\s*⏳)?/u.exec(text);
  if (!match) return undefined;

  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1) return undefined;
  return index;
};

// Matches, at `lastIndex`, the longest prefix of a text that trims to exactly one marker.
const TOOL_REF_PREFIX_REG = new RegExp(`\\s*(?:${MINDROOM_TOOL_REF_HTML_REG_G.source})\\s*`, 'y');

// What a child adds to the HTML a marker is matched in, or undefined when no
// marker can span it.
const getToolRefChildHtml = (child: ChildNode): string | undefined => {
  if (isDomTextNode(child)) return child.data;
  if (isDomElementNode(child) && child.name === 'code') {
    return `<code>${extractTextFromChildren(child.children)}</code>`;
  }
  if (isDomElementNode(child) && child.name === 'span') {
    return extractTextFromChildren(child.children);
  }
  return undefined;
};

/**
 * Offers `take` the HTML of each marker that starts the element, in order,
 * until it declines one: the first marker starts the element, and each later
 * one starts what is left after the previous marker and its boundary. Returns
 * what is left after the last marker taken. The element is scanned once,
 * however many markers it holds.
 */
export const takeLeadingToolRefs = (
  element: Element,
  take: (html: string) => boolean
): ChildNode[] => {
  const children = element.children as ChildNode[];
  if (!['p', 'div', 'li'].includes(element.name)) return children;

  // What is left starts `split` characters into children[start]. The children
  // a marker can span from there are joined once into `html`, in which
  // children[runStart + i] ends at childEnds[i].
  let start = 0;
  let split = 0;
  let runStart = 0;
  let html = '';
  let childEnds: number[] = [];
  const joinRun = () => {
    runStart = start;
    html = '';
    childEnds = [];
    for (let childIndex = start; childIndex < children.length; childIndex += 1) {
      const childHtml = getToolRefChildHtml(children[childIndex]);
      if (childHtml === undefined) break;
      html += childHtml;
      childEnds.push(html.length);
    }
  };
  const childStartOf = (childIndex: number): number =>
    childIndex === runStart ? 0 : childEnds[childIndex - runStart - 1];
  const skipWhitespaceText = () => {
    while (start < children.length) {
      const child = children[start];
      if (!isDomTextNode(child) || child.data.slice(split).trim()) break;
      start += 1;
      split = 0;
    }
  };

  joinRun();
  for (;;) {
    // A prefix is a marker exactly when it ends between the marker's `]` and the end of this
    // match, so one anchored match replaces parsing every prefix.
    const from = childStartOf(start) + split;
    TOOL_REF_PREFIX_REG.lastIndex = from;
    const match = TOOL_REF_PREFIX_REG.exec(html);
    if (!match || !parseMindroomToolRefHtml(match[0])) break;
    const longest = from + match[0].length;
    // The `]` comes before the optional pending icon and the trailing whitespace.
    const shortest = from + match[0].trimEnd().length - (match[3]?.length ?? 0);

    let end: number | undefined;
    let endChild = start;
    for (let childIndex = start; childIndex < runStart + childEnds.length; childIndex += 1) {
      const childStart = childIndex === start ? from : childStartOf(childIndex);
      if (childStart > longest) break;
      const childEnd = childEnds[childIndex - runStart];
      // Prefer the longest valid marker prefix (e.g. include optional " ⏳" when present).
      // Only a text child can be split.
      const candidate = isDomTextNode(children[childIndex])
        ? Math.min(childEnd, longest)
        : childEnd;
      if (childStart <= candidate && shortest <= candidate && candidate <= longest) {
        end = candidate;
        endChild = childIndex;
      }
    }
    if (end === undefined || !take(html.slice(from, end))) break;

    // Continue after the marker and its boundary: whitespace, then one line
    // break and more whitespace.
    const endsInsideChild = end < childEnds[endChild - runStart];
    start = endsInsideChild ? endChild : endChild + 1;
    split = endsInsideChild ? end - childStartOf(endChild) : 0;
    skipWhitespaceText();
    const next = children[start];
    if (isDomElementNode(next) && next.name === 'br') {
      start += 1;
      skipWhitespaceText();
      joinRun();
    }
  }

  const rest = children.slice(start);
  const first = rest[0];
  if (split > 0 && isDomTextNode(first)) rest[0] = new DOMText(first.data.slice(split));
  return rest;
};

export const getToolRefPrefixFromElement = (element: Element): ToolRefElementPrefix | undefined => {
  let prefixHtml = '';
  const trailingChildren = takeLeadingToolRefs(element, (html) => {
    if (prefixHtml) return false;
    prefixHtml = html;
    return true;
  });
  return prefixHtml ? { html: prefixHtml, trailingChildren } : undefined;
};

export const countMindroomToolRefIcons = (text: string): number =>
  text.split(MINDROOM_TOOL_REF_ICON).length - 1;

export type RenderedMindroomToolRefs = {
  /** Markers shown as tool blocks, in document order. */
  toolBlocks: MindroomToolRefParseResult[];
  /**
   * 🔧 icons anywhere in the rendered text or in any attribute, tool-block
   * markers included. Attributes count because the renderer shows some, such
   * as KaTeX `data-mx-maths` and code-block labels.
   */
  iconCount: number;
  /** 🔧 icons inside the tool-block markers. */
  toolBlockIconCount: number;
};

/**
 * Tool markers the message renderer shows as tool blocks in this sanitized
 * HTML. The renderer applies its tool rule to top-level containers and to the
 * content it re-wraps after a marker. The base parser renders lists, quotes,
 * and headings with its own options, so markers there stay text; wrappers it
 * leaves alone (`div`, `details`) do show nested markers, which this skips.
 */
export const getRenderedMindroomToolRefs = (html: string): RenderedMindroomToolRefs => {
  const toolBlocks: MindroomToolRefParseResult[] = [];
  let toolBlockIconCount = 0;
  const visit = (node: ChildNode) => {
    if (!isDomElementNode(node)) return;
    // Necessary for a match, and far cheaper than the prefix scan.
    const text = extractTextFromChildren(node.children as ChildNode[]);
    if (!text.trimStart().startsWith(MINDROOM_TOOL_REF_ICON)) return;

    takeLeadingToolRefs(node, (html) => {
      const toolRef = parseMindroomToolRefHtml(html);
      // The renderer groups by the first bracketed number in the text, so a name
      // holding another index can hide the block; count it as text instead.
      // The marker starts the text, so that number is in the marker.
      if (!toolRef || parseToolRefIndexFromTextPrefix(html) !== toolRef.index) return false;

      toolBlocks.push(toolRef);
      toolBlockIconCount += countMindroomToolRefIcons(html);
      return true;
    });
  };

  const countAttributeIcons = (nodes: ChildNode[]): number =>
    nodes.reduce(
      (count, node) =>
        isDomElementNode(node)
          ? count +
            Object.values(node.attribs).reduce(
              (sum, value) => sum + countMindroomToolRefIcons(value),
              0
            ) +
            countAttributeIcons(node.children as ChildNode[])
          : count,
      0
    );

  const nodes = htmlToDOM(html) as ChildNode[];
  nodes.forEach(visit);
  return {
    toolBlocks,
    iconCount:
      countMindroomToolRefIcons(extractTextFromChildren(nodes)) + countAttributeIcons(nodes),
    toolBlockIconCount,
  };
};
