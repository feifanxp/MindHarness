import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInScrollView, isIntersectingScrollView, pauseAllMediaElements, selectFile } from './dom';

describe('dom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks full containment using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 250,
        bottom: 300,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(true);
  });

  it('returns false when the child extends above the visible scroll range', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 180,
        bottom: 220,
      }),
    } as HTMLElement;

    expect(isInScrollView(scrollElement, childElement)).toBe(false);
  });

  it('detects partial intersection using viewport-relative rectangles', () => {
    const scrollElement = {
      getBoundingClientRect: () => ({
        top: 200,
        bottom: 500,
      }),
    } as HTMLElement;
    const childElement = {
      getBoundingClientRect: () => ({
        top: 480,
        bottom: 540,
      }),
    } as HTMLElement;

    expect(isIntersectingScrollView(scrollElement, childElement)).toBe(true);
  });

  it('pauses all audio and video elements on the page', () => {
    const originalDocument = globalThis.document;
    const pauseAudio = vi.fn();
    const pauseVideo = vi.fn();

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelectorAll: vi.fn(() => [{ pause: pauseAudio }, { pause: pauseVideo }]),
      },
    });

    try {
      pauseAllMediaElements();

      expect(pauseAudio).toHaveBeenCalledOnce();
      expect(pauseVideo).toHaveBeenCalledOnce();
    } finally {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });
});

type MockListener = EventListenerOrEventListenerObject;

class MockEventDispatcher {
  private readonly listeners = new Map<string, Array<{ listener: MockListener; once: boolean }>>();

  addEventListener(
    type: string,
    listener: MockListener | null,
    options?: boolean | AddEventListenerOptions
  ) {
    if (!listener) return;

    const once = typeof options === 'object' && options !== null ? Boolean(options.once) : false;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: MockListener | null) {
    if (!listener) return;

    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener)
    );
  }

  dispatchEvent(event: Event): boolean {
    const listeners = [...(this.listeners.get(event.type) ?? [])];

    listeners.forEach(({ listener, once }) => {
      if (once) {
        this.removeEventListener(event.type, listener);
      }

      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    });

    return true;
  }
}

class MockBody {
  private inputs: MockFileInput[] = [];

  appendChild(input: MockFileInput) {
    this.inputs.push(input);
    input.parentNode = this;
    return input as unknown as HTMLInputElement;
  }

  removeChild(input: MockFileInput) {
    this.inputs = this.inputs.filter((candidate) => candidate !== input);
    if (input.parentNode === this) {
      input.parentNode = null;
    }
    return input as unknown as HTMLInputElement;
  }

  querySelectorAll(selector: string) {
    if (selector === 'input[type=file]') {
      return this.inputs.filter((input) => input.type === 'file') as unknown as NodeListOf<HTMLInputElement>;
    }

    if (selector === 'input[type=file][aria-hidden="true"]') {
      return this.inputs.filter(
        (input) => input.type === 'file' && input.getAttribute('aria-hidden') === 'true'
      ) as unknown as NodeListOf<HTMLInputElement>;
    }

    return [] as unknown as NodeListOf<HTMLInputElement>;
  }
}

class MockFileInput extends MockEventDispatcher {
  public type = '';

  public accept = '';

  public multiple = false;

  public style = {} as CSSStyleDeclaration;

  public tabIndex = 0;

  public files: FileList | null = null;

  public parentNode: MockBody | null = null;

  public clickCount = 0;

  public wasAttachedOnClick = false;

  private readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  click() {
    this.clickCount += 1;
    this.wasAttachedOnClick = this.parentNode !== null;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

class MockDocument {
  public readonly body = new MockBody();

  public readonly createdInputs: MockFileInput[] = [];

  createElement(tagName: string) {
    if (tagName !== 'input') {
      throw new Error(`Unexpected tag: ${tagName}`);
    }

    const input = new MockFileInput();
    this.createdInputs.push(input);
    return input as unknown as HTMLInputElement;
  }
}

class MockWindow extends MockEventDispatcher {
  setTimeout = globalThis.setTimeout.bind(globalThis);

  clearTimeout = globalThis.clearTimeout.bind(globalThis);
}

const createFile = (name: string, type = 'image/png') => new File(['file'], name, { type });

const createFileList = (files: File[]): FileList => {
  const fileList = {
    length: files.length,
    item(index: number) {
      return files[index] ?? null;
    },
  } as FileList & Record<number, File>;

  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, {
      configurable: true,
      enumerable: true,
      value: file,
    });
  });

  return fileList;
};

const installMockFilePickerDom = () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = new MockDocument();
  const window = new MockWindow();

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: window,
  });

  return {
    document,
    window,
    getInput(index = document.createdInputs.length - 1) {
      const input = document.createdInputs[index];
      if (!input) {
        throw new Error(`Missing mock input at index ${index}`);
      }
      return input;
    },
    restore() {
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }

      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: originalWindow,
        });
      }
    },
  };
};

describe('selectFile', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends the input to document.body before clicking and removes it after resolution', async () => {
    const env = installMockFilePickerDom();

    try {
      const promise = selectFile('image/*');
      const input = env.getInput();
      const file = createFile('attached.png');

      expect(input.wasAttachedOnClick).toBe(true);
      expect(input.clickCount).toBe(1);
      expect(input.style.position).toBe('fixed');
      expect(input.style.left).toBe('-9999px');
      expect(input.style.opacity).toBe('0');
      expect(input.style.pointerEvents).toBe('none');
      expect(input.getAttribute('aria-hidden')).toBe('true');
      expect(input.tabIndex).toBe(-1);
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(1);

      input.files = createFileList([file]);
      input.dispatchEvent(new Event('change'));

      await expect(promise).resolves.toBe(file);
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('resolves the chosen File on change and returns File[] when multiple=true', async () => {
    const env = installMockFilePickerDom();

    try {
      const singlePromise = selectFile('image/*');
      const singleInput = env.getInput();
      const singleFile = createFile('single.png');

      singleInput.files = createFileList([singleFile]);
      singleInput.dispatchEvent(new Event('change'));
      await expect(singlePromise).resolves.toBe(singleFile);

      const multiplePromise = selectFile('image/*', true);
      const multipleInput = env.getInput();
      const firstFile = createFile('first.png');
      const secondFile = createFile('second.png');

      multipleInput.files = createFileList([firstFile, secondFile]);
      multipleInput.dispatchEvent(new Event('change'));
      await expect(multiplePromise).resolves.toEqual([firstFile, secondFile]);
    } finally {
      env.restore();
    }
  });

  it('resolves undefined when change fires with an empty FileList', async () => {
    const env = installMockFilePickerDom();

    try {
      const promise = selectFile('image/*');
      const input = env.getInput();

      input.files = createFileList([]);
      input.dispatchEvent(new Event('change'));

      await expect(promise).resolves.toBeUndefined();
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('resolves [] when multiple=true and change fires with an empty FileList', async () => {
    const env = installMockFilePickerDom();

    try {
      const promise = selectFile('image/*', true);
      const input = env.getInput();

      input.files = createFileList([]);
      input.dispatchEvent(new Event('change'));

      await expect(promise).resolves.toEqual([]);
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('resolves undefined and cleans up when the native cancel event fires', async () => {
    const env = installMockFilePickerDom();

    try {
      const promise = selectFile('image/*');
      const input = env.getInput();

      input.dispatchEvent(new Event('cancel'));
      await expect(promise).resolves.toBeUndefined();
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
      expect(input.parentNode).toBeNull();
    } finally {
      env.restore();
    }
  });

  it('keeps the picker alive when change arrives 600ms after window focus', async () => {
    vi.useFakeTimers();
    const env = installMockFilePickerDom();

    try {
      let settled = false;
      const promise = selectFile('image/*');
      void promise.then(() => {
        settled = true;
      });
      const input = env.getInput();
      const file = createFile('late-change.png');

      env.window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(600);
      expect(settled).toBe(false);
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(1);

      input.files = createFileList([file]);
      input.dispatchEvent(new Event('change'));
      await expect(promise).resolves.toBe(file);
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('keeps concurrent selectFile calls isolated from each other', async () => {
    const env = installMockFilePickerDom();

    try {
      const firstPromise = selectFile('image/*');
      const secondPromise = selectFile('image/*', true);
      const firstInput = env.getInput(0);
      const secondInput = env.getInput(1);
      const firstFile = createFile('first-call.png');
      const secondFile = createFile('second-call-a.png');
      const thirdFile = createFile('second-call-b.png');

      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(2);

      firstInput.files = createFileList([firstFile]);
      firstInput.dispatchEvent(new Event('change'));

      secondInput.files = createFileList([secondFile, thirdFile]);
      secondInput.dispatchEvent(new Event('change'));

      await expect(firstPromise).resolves.toBe(firstFile);
      await expect(secondPromise).resolves.toEqual([secondFile, thirdFile]);
      expect(firstInput.parentNode).toBeNull();
      expect(secondInput.parentNode).toBeNull();
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('leaves no leftover file-input siblings after repeated success and cancel flows', async () => {
    vi.useFakeTimers();
    const env = installMockFilePickerDom();

    try {
      const successPromise = selectFile('image/*');
      const successInput = env.getInput();
      successInput.files = createFileList([createFile('success.png')]);
      successInput.dispatchEvent(new Event('change'));
      await successPromise;
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);

      const emptyPromise = selectFile('image/*');
      const emptyInput = env.getInput(1);
      emptyInput.files = createFileList([]);
      emptyInput.dispatchEvent(new Event('change'));
      await expect(emptyPromise).resolves.toBeUndefined();
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);

      const cancelPromise = selectFile('image/*');
      const cancelInput = env.getInput(2);
      cancelInput.dispatchEvent(new Event('cancel'));
      await expect(cancelPromise).resolves.toBeUndefined();
      expect(env.document.body.querySelectorAll('input[type=file]')).toHaveLength(0);
    } finally {
      env.restore();
    }
  });
});
