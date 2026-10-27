import { ChildNode, Element } from 'domhandler';

import type { ParagraphElement, PasteMarkerElement } from '../../components/editor/slate';
import { BlockType } from '../../components/editor/types';
import { sanitizeText } from '../../utils/sanitize';
import {
  formatMindroomPasteMarkerAsHtml,
  parseMindroomPasteMarker,
} from '../messages/pasteAttachmentMarker';

export type MindroomEditorTextExtractor = (node: ChildNode) => string;

export const formatMindroomEditorMathMarkdown = (latex: string, displayMode: boolean): string =>
  displayMode ? `$$${latex}$$` : `$${latex}$`;

const splitMindroomEditorMathLines = (latex: string): string[] => latex.split(/\r?\n/);

const hasMindroomEditorMathLineBreak = (latex: string): boolean => /[\r\n]/.test(latex);

const isMindroomEditorMathElement = (node: Element): boolean =>
  (node.name === 'span' || node.name === 'div') && node.attribs['data-mx-maths'] !== undefined;

export const isMindroomEditorMathBlockElement = (node: Element): boolean =>
  node.name === 'div' && node.attribs['data-mx-maths'] !== undefined;

export const getMindroomEditorMathLatex = (
  node: Element,
  getText: MindroomEditorTextExtractor
): string | undefined => {
  const latex = node.attribs['data-mx-maths'];
  if (typeof latex === 'string' && latex.length > 0) {
    return latex;
  }

  const text = getText(node);
  return text.length > 0 ? text : undefined;
};

export const getMindroomEditorMathText = (
  node: Element,
  getText: MindroomEditorTextExtractor,
  markdown?: boolean
): string | undefined => {
  if (!isMindroomEditorMathElement(node)) return undefined;

  const latex = getMindroomEditorMathLatex(node, getText);
  if (!latex) return undefined;

  const displayMode = node.name === 'div';
  return markdown ? formatMindroomEditorMathMarkdown(latex, displayMode) : latex;
};

export const parseMindroomEditorMathBlock = (
  node: Element,
  getText: MindroomEditorTextExtractor,
  markdown?: boolean
): ParagraphElement[] => {
  const latex = getMindroomEditorMathLatex(node, getText);
  if (!latex) return [];

  if (!markdown) {
    return splitMindroomEditorMathLines(latex).map<ParagraphElement>((lineText) => ({
      type: BlockType.Paragraph,
      children: [{ text: lineText }],
    }));
  }

  if (!hasMindroomEditorMathLineBreak(latex)) {
    return [
      {
        type: BlockType.Paragraph,
        children: [{ text: formatMindroomEditorMathMarkdown(latex, true) }],
      },
    ];
  }

  return [
    {
      type: BlockType.Paragraph,
      children: [{ text: '$$' }],
    },
    ...splitMindroomEditorMathLines(latex).map<ParagraphElement>((lineText) => ({
      type: BlockType.Paragraph,
      children: [{ text: lineText }],
    })),
    {
      type: BlockType.Paragraph,
      children: [{ text: '$$' }],
    },
  ];
};

export const getMindroomEditorPasteMarkerElement = (
  node: Element,
  getText: MindroomEditorTextExtractor
): PasteMarkerElement | undefined => {
  if (node.name !== 'span' || node.attribs['data-mindroom-paste-marker'] !== 'true') {
    return undefined;
  }

  const marker = parseMindroomPasteMarker(getText(node));
  if (!marker) return undefined;

  return {
    type: BlockType.PasteMarker,
    id: marker.id,
    chars: marker.chars,
    fileName: marker.fileName,
    marker: marker.raw,
    children: [{ text: '' }],
  };
};

export const mindroomEditorPasteMarkerElementToCustomHtml = (node: PasteMarkerElement): string => {
  const marker = parseMindroomPasteMarker(node.marker);
  return marker ? formatMindroomPasteMarkerAsHtml(marker) : sanitizeText(node.marker);
};

export const mindroomEditorPasteMarkerElementToPlainText = (node: PasteMarkerElement): string =>
  node.marker;
