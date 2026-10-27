import React, { RefObject } from 'react';

type CallEmbedHostProps = {
  containerRef: RefObject<HTMLDivElement>;
  visible: boolean;
};

export function CallEmbedHost({ containerRef, visible }: CallEmbedHostProps) {
  return (
    <div
      data-call-embed-container
      style={{
        visibility: visible ? undefined : 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '50%',
        overflow: 'hidden',
      }}
      ref={containerRef}
    />
  );
}
