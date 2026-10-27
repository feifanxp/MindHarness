declare module '@novnc/novnc' {
  export type RFBOptions = {
    wsProtocols?: string[];
  };

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);

    scaleViewport: boolean;

    viewOnly: boolean;

    disconnect(): void;

    focus(options?: FocusOptions): void;
  }
}
