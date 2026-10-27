import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { ProviderModelIcon } from './ProviderModelIcon';

describe('ProviderModelIcon', () => {
  it.each([
    'gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'publishers/google/models/gemini-2.5-flash',
    'google.gemini-2.5-pro',
    'google:gemini-2.5-flash',
    'GEMINI-2.5-PRO',
  ])('uses the Google glyph for OpenAI-compatible model %s', (id) => {
    const renderer = create(<ProviderModelIcon provider="openai" id={id} size={20} />);

    expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-brand-google');
  });

  it.each(['gpt-4.1', 'anti-gemini-detector', 'google/gemini/model', 'geminized-model'])(
    'preserves the OpenAI glyph for unrelated model %s',
    (id) => {
      const renderer = create(<ProviderModelIcon provider="openai" id={id} size={20} />);

      expect(renderer.root.findByType('svg').props.className).toContain('tabler-icon-brand-openai');
    }
  );
});
