import React from 'react';
import type { SearchResultBodyRenderer } from './SearchResultGroup';
import { MindroomSearchResultBody } from './MindroomSearchResultBody';

export const renderMindroomSearchResultBody: SearchResultBodyRenderer = (props) => (
  <MindroomSearchResultBody {...props} />
);
