import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MindroomModelBadge } from './MindroomModelBadge';
import { getMindroomAiRunInfo } from './aiRun';

vi.mock('./MindroomModelBadge.css', () => ({
  Badge: 'Badge',
  Icon: 'Icon',
  Label: 'Label',
}));

describe('MindroomModelBadge', () => {
  it.each([
    ['  my Friendly Model  ', 'my Friendly Model', 'my Friendly Model · friendly_alias (openai)'],
    [undefined, 'Friendly Alias', 'friendly_alias (openai)'],
    ['   ', 'Friendly Alias', 'friendly_alias (openai)'],
    [42, 'Friendly Alias', 'friendly_alias (openai)'],
  ])(
    'renders model display name %s with an alias fallback',
    (displayName, expectedLabel, details) => {
      const info = getMindroomAiRunInfo({
        'io.mindroom.ai_run': {
          version: 1,
          model: { config: 'friendly_alias', display_name: displayName, provider: 'openai' },
        },
      });
      const renderer = create(<MindroomModelBadge info={info!} />);

      expect(renderer.root.findByProps({ className: 'Label' }).children).toEqual([expectedLabel]);
      const badge = renderer.root.findByProps({ title: details });
      expect(badge.props['aria-label']).toBe(`Model: ${details}`);
    }
  );

  it('uses the Anthropic mark for Claude models routed through Vertex AI', () => {
    const renderer = create(
      <MindroomModelBadge
        info={{
          modelConfig: 'fable',
          modelProvider: 'vertexai',
          modelId: 'claude-fable-5',
        }}
      />
    );

    const badge = renderer.root.findByProps({
      'aria-label': 'Model: fable (vertexai / claude-fable-5)',
    });
    const icon = badge.findByType('svg');

    expect(icon.props.viewBox).toBe('0 0 24 24');
    expect(icon.props.fill).toBe('currentColor');
    expect(icon.findByType('path').props.d).toContain('17.3041 3.541');
    expect(badge.findByProps({ className: 'Label' }).children).toEqual(['Fable']);
  });

  it.each([
    ['vertexai', 'publishers/anthropic/models/claude-fable-5'],
    ['bedrock', 'anthropic.claude-fable-5'],
  ])('recognizes provider-prefixed Claude model IDs from %s', (modelProvider, modelId) => {
    const renderer = create(
      <MindroomModelBadge info={{ modelConfig: 'fable', modelProvider, modelId }} />
    );

    const icon = renderer.root.findByType('svg');

    expect(icon.props.fill).toBe('currentColor');
    expect(icon.findByType('path').props.d).toContain('17.3041 3.541');
  });

  it.each(['anti-claude-detector', 'foo/claude/bar', 'claudette-5'])(
    'keeps the generic provider icon for unrelated model ID %s',
    (modelId) => {
      const renderer = create(
        <MindroomModelBadge info={{ modelConfig: 'fable', modelProvider: 'vertexai', modelId }} />
      );

      const anthropicPaths = renderer.root
        .findByType('svg')
        .findAllByType('path')
        .filter((path) => String(path.props.d).includes('17.3041 3.541'));

      expect(anthropicPaths).toHaveLength(0);
    }
  );
});
