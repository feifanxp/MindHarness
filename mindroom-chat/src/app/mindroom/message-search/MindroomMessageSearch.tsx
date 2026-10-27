import React from 'react';
import { MessageSearch, type MessageSearchProps } from './MessageSearch';
import { renderMindroomSearchResultBody } from './searchResultBodyRenderer';

export type MindroomMessageSearchProps = Omit<MessageSearchProps, 'renderBody'>;

export function MindroomMessageSearch(props: MindroomMessageSearchProps) {
  return <MessageSearch {...props} renderBody={renderMindroomSearchResultBody} />;
}
