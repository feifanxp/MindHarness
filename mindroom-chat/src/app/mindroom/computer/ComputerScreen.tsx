import React, { useEffect, useRef } from 'react';
import RFB from '@novnc/novnc';
import * as css from './ComputerPanel.css';

export type RfbClient = {
  addEventListener(name: string, listener: EventListener): void;
  removeEventListener(name: string, listener: EventListener): void;
  disconnect(): void;
  focus(options?: FocusOptions): void;
  scaleViewport: boolean;
  viewOnly: boolean;
};

export type RfbFactory = (
  target: HTMLElement,
  url: string,
  options: { wsProtocols: string[] }
) => RfbClient;

export type ComputerScreenProps = {
  url: string;
  protocols: [string, string];
  mode: 'view' | 'control';
  onConnected: () => void;
  onDisconnected: (message?: string) => void;
  createRfb?: RfbFactory;
};

const defaultRfbFactory: RfbFactory = (target, url, options) => new RFB(target, url, options);

export function ComputerScreen({
  url,
  protocols,
  mode,
  onConnected,
  onDisconnected,
  createRfb = defaultRfbFactory,
}: ComputerScreenProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbClient>();
  const connectedCallbackRef = useRef(onConnected);
  const disconnectedCallbackRef = useRef(onDisconnected);

  connectedCallbackRef.current = onConnected;
  disconnectedCallbackRef.current = onDisconnected;
  const binaryProtocol = protocols[0];
  const ticketProtocol = protocols[1];

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;

    const rfb = createRfb(target, url, { wsProtocols: [binaryProtocol, ticketProtocol] });
    rfb.scaleViewport = true;
    rfbRef.current = rfb;

    const handleConnect = () => connectedCallbackRef.current();
    const handleDisconnect = (event: Event) => {
      const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
      disconnectedCallbackRef.current(
        detail?.clean === false ? 'The computer connection was interrupted.' : undefined
      );
    };
    const handleSecurityFailure = () =>
      disconnectedCallbackRef.current('The computer connection was denied.');
    const keepInputInsideComputer = (event: Event) => event.stopPropagation();

    rfb.addEventListener('connect', handleConnect);
    rfb.addEventListener('disconnect', handleDisconnect);
    rfb.addEventListener('securityfailure', handleSecurityFailure);
    target.addEventListener('keydown', keepInputInsideComputer);
    target.addEventListener('paste', keepInputInsideComputer);

    return () => {
      rfb.removeEventListener('connect', handleConnect);
      rfb.removeEventListener('disconnect', handleDisconnect);
      rfb.removeEventListener('securityfailure', handleSecurityFailure);
      target.removeEventListener('keydown', keepInputInsideComputer);
      target.removeEventListener('paste', keepInputInsideComputer);
      rfbRef.current = undefined;
      rfb.disconnect();
    };
  }, [binaryProtocol, createRfb, ticketProtocol, url]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = mode !== 'control';
    if (mode === 'control') {
      rfb.focus({ preventScroll: true });
    }
  }, [mode]);

  return (
    <div
      ref={targetRef}
      className={css.Screen}
      data-mindroom-computer-input
      onPointerDown={() => rfbRef.current?.focus({ preventScroll: true })}
      role="application"
      aria-label="Agent computer"
      // The RFB surface must receive raw keyboard input while the user controls it.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    />
  );
}

export default ComputerScreen;
