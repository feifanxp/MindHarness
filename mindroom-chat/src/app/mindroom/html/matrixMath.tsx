import React from 'react';
import classNames from 'classnames';
import { HTMLReactParserOptions, attributesToProps, domToReact } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import Linkify from 'linkify-react';
import { Opts as LinkifyOpts } from 'linkifyjs';
import {
  renderLatexToHtml,
  tokenizeTextWithLatex,
  unescapeLatexDelimiters,
} from '../../plugins/math';
import * as css from './MatrixMath.css';

type StyledTextRenderer = (text: string, highlightRegex?: RegExp) => (string | JSX.Element)[];

const formatRawLatex = (latex: string, displayMode: boolean): string =>
  displayMode ? `$$${latex}$$` : `$${latex}$`;

const MatrixMathHtml = ({
  latex,
  displayMode,
  className,
  fallback,
  as = 'span',
}: {
  latex: string;
  displayMode: boolean;
  className: string;
  fallback?: React.ReactNode;
  as?: 'span' | 'div';
}) => {
  const renderedHtml = renderLatexToHtml(latex, displayMode);
  const Tag = as;

  if (renderedHtml === latex) {
    return <Tag className={className}>{fallback ?? formatRawLatex(latex, displayMode)}</Tag>;
  }

  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
};

export const renderMatrixMathHtmlElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if ((name !== 'span' && name !== 'div') || typeof attribs['data-mx-maths'] !== 'string') {
    return undefined;
  }

  const props = attributesToProps(attribs);
  const latex = attribs['data-mx-maths'];
  const fallback = children.length > 0 ? domToReact(children, opts) : undefined;

  return (
    <MatrixMathHtml
      as={name === 'div' ? 'div' : 'span'}
      latex={latex}
      displayMode={name === 'div'}
      fallback={fallback}
      className={classNames(name === 'div' ? css.MathBlock : css.MathInline, props.className)}
    />
  );
};

export const renderTextWithMatrixMath = (
  text: string,
  params: {
    linkify?: boolean;
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    keyPrefix?: string;
    renderStyledText: StyledTextRenderer;
  }
): React.ReactNode => {
  const segments = tokenizeTextWithLatex(text, params.linkifyOpts);
  const hasEscapedDelimiters = segments.some(
    (segment) =>
      segment.type === 'text' && unescapeLatexDelimiters(segment.content) !== segment.content
  );
  const hasMath = segments.some((segment) => segment.type === 'math');
  const hasOnlyPlainText = segments.every((segment) => segment.type === 'text');

  if (hasOnlyPlainText && !hasEscapedDelimiters && !hasMath) {
    const jsx = params.renderStyledText(text, params.highlightRegex);
    if (params.linkify === false) return jsx;
    return <Linkify options={params.linkifyOpts}>{jsx}</Linkify>;
  }

  return segments
    .map((segment, index) => {
      const key = `${params.keyPrefix ?? 'latex'}-${index}`;

      if (segment.type === 'math') {
        return (
          <MatrixMathHtml
            key={key}
            as="span"
            latex={segment.content}
            displayMode={segment.displayMode}
            className={segment.displayMode ? css.MathBlock : css.MathInline}
          />
        );
      }

      const content =
        segment.type === 'text' ? unescapeLatexDelimiters(segment.content) : segment.content;
      if (content === '') return null;

      const jsx = params.renderStyledText(content, params.highlightRegex);
      if (params.linkify === false || segment.type === 'verbatim') {
        return <React.Fragment key={key}>{jsx}</React.Fragment>;
      }

      return (
        <Linkify key={key} options={params.linkifyOpts}>
          {jsx}
        </Linkify>
      );
    })
    .filter((node) => node !== null);
};
