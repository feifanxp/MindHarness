// @vitest-environment jsdom

import { PostmessageTransport, WidgetApiDirection } from 'matrix-widget-api';
import { describe, expect, it, vi } from 'vitest';
import { restrictCallTransportToSameOrigin } from './CallEmbed';

const fromWidget = (origin: string) =>
  new MessageEvent('message', {
    origin,
    data: {
      api: WidgetApiDirection.FromWidget,
      widgetId: 'call-embed',
      requestId: 'request',
      action: 'send_event',
      data: { type: 'm.room.redaction', content: { redacts: '$event' } },
    },
  });

describe('call widget transport', () => {
  it('accepts opaque-origin requests unless restricted, which is why calls restrict it', () => {
    const transport = new PostmessageTransport(
      WidgetApiDirection.ToWidget,
      'call-embed',
      window,
      window
    );
    const requests = vi.fn();
    transport.on('message', requests);
    transport.start();
    window.dispatchEvent(fromWidget('null'));
    expect(requests).toHaveBeenCalledOnce();
    transport.stop();
  });

  it('ignores widget requests from other origins, such as an opaque agent canvas', () => {
    const transport = new PostmessageTransport(
      WidgetApiDirection.ToWidget,
      'call-embed',
      window,
      window
    );
    restrictCallTransportToSameOrigin({ transport } as never);
    const requests = vi.fn();
    transport.on('message', requests);
    transport.start();

    window.dispatchEvent(fromWidget('null'));
    expect(requests).not.toHaveBeenCalled();

    window.dispatchEvent(fromWidget(window.location.origin));
    expect(requests).toHaveBeenCalledOnce();
    transport.stop();
  });
});
