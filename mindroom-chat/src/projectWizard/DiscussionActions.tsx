import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, PopOut, color, type RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { IconArchive, IconArchiveOff, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { Menu, MenuItem, Surface } from '../app/components/glass/GlassPrimitives';
import { wizardRequest, type WizardState } from './api';

export type DiscussionSummary = {
  draft_id: string;
  name: string;
  status: string;
  updated_at: number;
  revision: number;
  archived?: boolean;
};
export type DiscussionAction = 'rename' | 'archive' | 'delete';

export function DiscussionActions({
  item,
  onChanged,
}: {
  item: DiscussionSummary;
  onChanged: (id: string, action: DiscussionAction, state: WizardState | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [anchor, setAnchor] = useState<RectCords>();
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (action && !dialog.current?.open) dialog.current?.showModal();
  }, [action]);

  const closeMenu = () => {
    setAnchor(undefined);
    trigger.current?.focus();
  };
  const openDialog = (next: 'rename' | 'delete') => {
    closeMenu();
    setName(item.name);
    setError('');
    setAction(next);
  };
  const closeDialog = () => {
    if (inFlight.current) return;
    dialog.current?.close();
    setAction(null);
    setError('');
    trigger.current?.focus();
  };
  const run = async (kind: DiscussionAction) => {
    if (inFlight.current || (kind === 'rename' && !name.trim())) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    closeMenu();
    try {
      const path = '/drafts/' + encodeURIComponent(item.draft_id);
      const state = await wizardRequest(
        kind === 'archive' ? path + '/archive' : path,
        kind === 'delete' ? 'DELETE' : 'PATCH',
        {
          revision: item.revision,
          ...(kind === 'rename' ? { name: name.trim() } : {}),
          ...(kind === 'archive' ? { archived: !item.archived } : {}),
        }
      );
      dialog.current?.close();
      setAction(null);
      onChanged(item.draft_id, kind, state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="discussion-actions-trigger"
        aria-label={'讨论操作：' + item.name}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        disabled={busy}
        onClick={(event) => {
          setError('');
          setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect());
        }}
      >
        <IconDots size={19} aria-hidden />
      </button>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="End"
        offset={5}
        content={
          <FocusTrap
            focusTrapOptions={{
              onDeactivate: closeMenu,
              clickOutsideDeactivates: true,
              returnFocusOnDeactivate: false,
              isKeyForward: (event: KeyboardEvent) =>
                event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey),
              isKeyBackward: (event: KeyboardEvent) =>
                event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey),
            }}
          >
            <Menu
              role="menu"
              className="discussion-actions-menu"
              aria-label={item.name + '的操作'}
              onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Home' && event.key !== 'End') return;
                const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
                (event.key === 'Home' ? buttons[0] : buttons[buttons.length - 1])?.focus();
                event.preventDefault();
              }}
            >
              <MenuItem role="menuitem" size="400" radii="300" onClick={() => openDialog('rename')}>
                <IconPencil size={19} aria-hidden />
                <span>重命名</span>
              </MenuItem>
              <MenuItem role="menuitem" size="400" radii="300" onClick={() => void run('archive')}>
                {item.archived ? (
                  <IconArchiveOff size={19} aria-hidden />
                ) : (
                  <IconArchive size={19} aria-hidden />
                )}
                <span>{item.archived ? '取消归档' : '归档'}</span>
              </MenuItem>
              <div
                className="discussion-menu-divider"
                style={{ borderColor: color.Surface.ContainerLine }}
              />
              <MenuItem
                role="menuitem"
                size="400"
                radii="300"
                variant="Critical"
                onClick={() => openDialog('delete')}
              >
                <IconTrash size={19} aria-hidden />
                <span>删除</span>
              </MenuItem>
            </Menu>
          </FocusTrap>
        }
      />
      {error && !action && (
        <p role="alert" className="discussion-action-error">
          {error}
        </p>
      )}
      {action && (
        <dialog
          ref={dialog}
          className="discussion-action-dialog"
          aria-labelledby={'discussion-action-' + item.draft_id}
          onCancel={(event) => {
            if (inFlight.current) event.preventDefault();
          }}
          onClose={() => {
            setAction(null);
            trigger.current?.focus();
          }}
        >
          <Surface className="discussion-action-panel">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (action) void run(action);
              }}
            >
              <h2 id={'discussion-action-' + item.draft_id}>
                {action === 'rename' ? '重命名讨论' : '删除讨论？'}
              </h2>
              {action === 'rename' ? (
                <label
                  className="discussion-name-field"
                  htmlFor={'discussion-name-' + item.draft_id}
                >
                  讨论名称
                  <input
                    id={'discussion-name-' + item.draft_id}
                    value={name}
                    maxLength={120}
                    required
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              ) : (
                <p>
                  将删除“{item.name}”的准备记录和列表入口，并停用该讨论的队友 BOT 与整理员。已有
                  Matrix
                  聊天记录保留，可在“更多聊天功能”查看。此操作无法从列表恢复；如需日后继续，请选择归档。
                </p>
              )}
              {error && (
                <p role="alert" className="discussion-action-error">
                  {error}
                </p>
              )}
              <Box gap="200" justifyContent="End" className="discussion-action-buttons">
                <Button
                  type="button"
                  size="400"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  radii="300"
                  disabled={busy}
                  onClick={closeDialog}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="400"
                  variant={action === 'delete' ? 'Critical' : 'Primary'}
                  fill="Soft"
                  outlined
                  radii="300"
                  disabled={busy || (action === 'rename' && !name.trim())}
                >
                  {busy ? '正在处理…' : action === 'delete' ? '删除讨论' : '保存'}
                </Button>
              </Box>
            </form>
          </Surface>
        </dialog>
      )}
    </>
  );
}
