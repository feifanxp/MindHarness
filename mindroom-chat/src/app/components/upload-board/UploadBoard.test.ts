import React from 'react';
import { Provider, atom, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { TUploadFamilyObserverAtom, UploadStatus } from '../../state/upload';
import { toMatrixUploadError } from '../../utils/matrix';
import { UploadBoardHeader } from './UploadBoard';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  const forwardTag = (tag: string) =>
    reactModule.forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      reactModule.createElement(tag, { ...props, ref }, children)
    );

  return {
    Badge: forwardTag('span'),
    Box: forwardTag('div'),
    Chip: forwardTag('button'),
    Header: forwardTag('header'),
    Icon: forwardTag('span'),
    Icons: {
      ChevronRight: 'ChevronRight',
      ChevronTop: 'ChevronTop',
      Cross: 'Cross',
      Send: 'Send',
    },
    Spinner: forwardTag('span'),
    Text: forwardTag('span'),
    as: (render: Parameters<typeof reactModule.forwardRef>[0]) => reactModule.forwardRef(render),
    percent: (min: number, max: number, value: number) => ((value - min) / (max - min)) * 100,
  };
});

vi.mock('./UploadBoard.css', () => ({
  UploadBoard: 'UploadBoard',
  UploadBoardBase: 'UploadBoardBase',
  UploadBoardContainer: 'UploadBoardContainer',
  UploadBoardContent: 'UploadBoardContent',
  UploadBoardHeaderContent: 'UploadBoardHeaderContent',
}));

const createFile = (name: string) => new File(['content'], name, { type: 'text/plain' });

describe('UploadBoardHeader', () => {
  it('keeps removal available without rendering a second Send action', async () => {
    const successful = createFile('sendable.txt');
    const failedPrep = createFile('failed.txt');
    const uploadFamilyObserverAtom = atom([
      {
        file: successful,
        status: UploadStatus.Success,
        mxc: 'mxc://mindroom/sendable',
      },
      {
        file: failedPrep,
        status: UploadStatus.Error,
        error: toMatrixUploadError(new Error('encryption failed'), 'create'),
      },
    ]) as TUploadFamilyObserverAtom;
    const onCancel = vi.fn();

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(UploadBoardHeader, {
            open: true,
            onToggle: vi.fn(),
            uploadFamilyObserverAtom,
            onCancel,
          })
        )
      );
    });

    const buttons = renderer.root.findAllByType('button');
    expect(
      buttons.some((button) =>
        button.findAllByType('span').some((span) => span.children.includes('Send'))
      )
    ).toBe(false);
    const removeButton = buttons.find((button) =>
      button.findAllByType('span').some((span) => span.children.includes('Remove All'))
    );
    expect(removeButton).toBeTruthy();
    await act(async () => {
      await removeButton?.props.onClick();
    });

    expect(onCancel).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          file: successful,
        }),
      ])
    );
  });
});
