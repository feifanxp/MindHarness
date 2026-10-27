import React from 'react';
import { attributesToProps, domToReact, HTMLReactParserOptions } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { renderMindroomHtmlBlock } from '../messages/MindroomHtmlBlocks';
import { renderMatrixMathHtmlElement } from './matrixMath';
import { ScrollableTable } from './ScrollableTable';

export const renderMindroomCustomHtmlElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if (name === 'table') {
    return (
      <ScrollableTable {...attributesToProps(attribs)}>
        {domToReact(children, opts)}
      </ScrollableTable>
    );
  }

  return (
    renderMatrixMathHtmlElement(name, attribs, children, opts) ??
    renderMindroomHtmlBlock(name, children, opts)
  );
};
