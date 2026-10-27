import { describe, expect, it } from 'vitest';
import { getRoomSearchParams } from './pathSearchParam';

describe('getRoomSearchParams', () => {
  it('returns undefined values when params are missing', () => {
    const result = getRoomSearchParams(new URLSearchParams());

    expect(result).toEqual({
      viaServers: undefined,
      threadId: undefined,
    });
  });

  it('reads viaServers and threadId from search params', () => {
    const result = getRoomSearchParams(
      new URLSearchParams({
        viaServers: 'matrix.org,example.org',
        threadId: '$thread-root-event',
      })
    );

    expect(result).toEqual({
      viaServers: 'matrix.org,example.org',
      threadId: '$thread-root-event',
    });
  });
});
