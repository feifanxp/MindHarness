import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Download, Pencil, Upload, Undo2, X } from 'lucide-react';
import {
  decodePresentationDraft,
  encodePresentationDraft,
  readPresentationDraft,
  PRESENTATION_DRAFT_KEY,
  type PresentationFields,
} from './presentationDraft';
import './presentationEditor.css';
import { isPortablePresentation, downloadPortablePresentation } from './presentationPortable';
import {
  loadPresentationFile,
  savePresentationFile,
  PresentationWriteConflict,
  type PresentationFile,
} from './presentationFileClient';

type Field = { id: string; original: string; label: string; initial: string };
type EditorState = {
  fields: PresentationFields;
  canEdit: boolean;
  busy: boolean;
  editing: boolean;
  setEditing: (value: boolean) => void;
  select: (field: Omit<Field, 'initial'>) => void;
};
const EditorContext = createContext<EditorState | null>(null);

export function usePresentationEditor() {
  const context = useContext(EditorContext);
  if (!context) throw new Error('Presentation editing requires its provider.');
  return context;
}

export function usePresentationText(id: string, original: string) {
  return usePresentationEditor().fields[id] ?? original;
}

export function EditableText({
  id,
  text,
  label,
  render,
}: {
  id: string;
  text: string;
  label?: string;
  render?: (value: string) => ReactNode;
}) {
  const { fields, editing, select } = usePresentationEditor();
  const value = fields[id] ?? text;
  const fieldLabel = label ?? (value || text).slice(0, 32);
  const activate = () => select({ id, original: text, label: fieldLabel });
  return (
    <span
      className="mh-editable-text"
      data-edit-field={id}
      role={editing ? 'button' : undefined}
      tabIndex={editing ? 0 : undefined}
      aria-label={editing ? '编辑：' + fieldLabel : undefined}
      onClick={
        editing
          ? event => {
              event.stopPropagation();
              activate();
            }
          : undefined
      }
      onKeyDown={
        editing
          ? event => {
              if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                event.stopPropagation();
                activate();
              }
            }
          : undefined
      }
    >
      {value === '' ? (
        editing ? (
          <span className="mh-empty-field">点击填写</span>
        ) : null
      ) : render ? (
        render(value)
      ) : (
        value
      )}
    </span>
  );
}

export function PresentationEditButton() {
  const { editing, setEditing, canEdit, busy } = usePresentationEditor();
  return (
    <button
      className="mh-edit-toggle"
      type="button"
      aria-pressed={editing}
      disabled={!canEdit || busy}
      onClick={() => setEditing(!editing)}
    >
      <Pencil size={14} aria-hidden="true" />
      {editing ? '完成编辑' : '编辑内容'}
    </button>
  );
}

export function PresentationEditor({ children }: { children: ReactNode }) {
  const portable = isPortablePresentation();
  const [local] = useState(() => {
    if (portable) return { fields: {} as PresentationFields, error: '' };
    try {
      return { fields: readPresentationDraft(localStorage), error: '' };
    } catch {
      return {
        fields: {} as PresentationFields,
        error: '本机旧稿无法读取，原记录未删除；可用之前导出的备份恢复。',
      };
    }
  });
  const [legacy, setLegacy] = useState(local.fields);
  const legacyRef = useRef(local.fields);
  const [legacyError, setLegacyError] = useState(local.error);
  const [document, setDocument] = useState<PresentationFile | null>(null);
  const documentRef = useRef<PresentationFile | null>(null);
  const fields = document?.fields ?? {};
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestSerial = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [history, setHistory] = useState<{ before: PresentationFields; after: string }[]>([]);
  const [selected, setSelected] = useState<Field | null>(null);
  const [value, setValue] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const canEdit = !loading && !!document?.writable;

  const accept = useCallback((next: PresentationFile, keepHistory = false) => {
    if (!keepHistory && documentRef.current?.revision !== next.revision) setHistory([]);
    documentRef.current = next;
    setDocument(next);
    setLoading(false);
    if (!next.writable) setEditing(false);
  }, []);
  const retireLocal = useCallback(() => {
    legacyRef.current = {};
    setLegacy({});
    try {
      localStorage.removeItem(PRESENTATION_DRAFT_KEY);
      setLegacyError('');
    } catch {
      setLegacyError('内容已经写入项目文件，但本机旧副本未能清除。');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let fetching = false;
    const refresh = async () => {
      if (!alive || fetching || busyRef.current) return;
      fetching = true;
      const serial = ++requestSerial.current;
      try {
        let current = await loadPresentationFile();
        if (!alive || serial !== requestSerial.current || busyRef.current) return;
        const old = legacyRef.current;
        if (Object.keys(old).length > 0 && current.writable) {
          const matches = Object.entries(old).every(([key, text]) => current.fields[key] === text);
          if (matches) retireLocal();
          else if (current.savedAt === null && Object.keys(current.fields).length === 0) {
            current = await savePresentationFile(current.revision, old);
            if (!alive || serial !== requestSerial.current) return;
            retireLocal();
          }
        }
        accept(current);
        setLoadError('');
      } catch (failure) {
        if (!alive || serial !== requestSerial.current) return;
        if (failure instanceof PresentationWriteConflict) accept(failure.current);
        setLoadError(failure instanceof Error ? failure.message : '读取项目文件失败，请重试。');
        setLoading(false);
      } finally {
        fetching = false;
      }
    };
    refreshRef.current = () => {
      void refresh();
    };
    void refresh();
    if (portable)
      return () => {
        alive = false;
        refreshRef.current = () => {};
      };
    const visibleRefresh = () => {
      if (window.document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(visibleRefresh, 4000);
    window.addEventListener('focus', visibleRefresh);
    window.document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.document.removeEventListener('visibilitychange', visibleRefresh);
      refreshRef.current = () => {};
    };
  }, [accept, retireLocal, portable]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!selected || !dialog) return;
    dialog.showModal();
    textareaRef.current?.focus();
    return () => dialog.close();
  }, [selected]);

  const runWrite = async (task: () => Promise<void>) => {
    if (busyRef.current || !canEdit) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    ++requestSerial.current;
    try {
      await task();
      setLoadError('');
    } catch (failure) {
      if (failure instanceof PresentationWriteConflict) accept(failure.current);
      setError(failure instanceof Error ? failure.message : '写入失败，请保留修改并重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const currentFile = async () => {
    const current = await loadPresentationFile();
    accept(current);
    if (!current.writable) throw new Error('当前是静态副本，保存需要运行演示服务。');
    return current;
  };
  const persist = async (next: PresentationFields, current: PresentationFile, remember = true) => {
    const saved = await savePresentationFile(current.revision, next);
    accept(saved, true);
    if (remember)
      setHistory(items => [...items.slice(-19), { before: current.fields, after: saved.revision }]);
    return saved;
  };
  const apply = (restore = false) => {
    if (!selected) return;
    void runWrite(async () => {
      const current = await currentFile();
      if ((current.fields[selected.id] ?? selected.original) !== selected.initial)
        throw new Error('这段文字已被其他设备修改，请取消后重新打开，再决定如何调整。');
      const next = { ...current.fields };
      if (restore || value === selected.original) delete next[selected.id];
      else next[selected.id] = value;
      await persist(next, current);
      setSelected(null);
    });
  };
  const select = (field: Omit<Field, 'initial'>) => {
    if (!canEdit || busyRef.current) return;
    const initial = fields[field.id] ?? field.original;
    setValue(initial);
    setSelected({ ...field, initial });
  };
  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    void runWrite(async () => {
      const current = await currentFile();
      if (current.revision !== previous.after) {
        setHistory([]);
        throw new Error('其他设备已更新文件，已停止撤销以保留这些修改。');
      }
      const saved = await persist(previous.before, current, false);
      setHistory(items => {
        const remaining = items.slice(0, -1);
        if (remaining.length)
          remaining[remaining.length - 1] = {
            ...remaining[remaining.length - 1],
            after: saved.revision,
          };
        return remaining;
      });
    });
  };
  const exportDraft = (contents = fields, filename = 'Mind-Harness-文字备份.json') => {
    const url = URL.createObjectURL(
      new Blob([encodePresentationDraft(contents)], { type: 'application/json' })
    );
    const link = window.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importDraft = async (file: File) => {
    let imported: PresentationFields;
    try {
      imported = decodePresentationDraft(await file.text());
    } catch {
      setError('备份格式无效，项目文件没有变化。');
      return;
    }
    if (
      !window.confirm(
        portable
          ? '导入备份会替换当前页面的修改，之后请保存新版 HTML。是否继续？'
          : '导入备份会替换项目文件中的文字修改，所有设备都会看到新版本。是否继续？'
      )
    )
      return;
    void runWrite(async () => {
      const current = await currentFile();
      await persist(imported, current);
    });
  };
  const migrate = () => {
    void runWrite(async () => {
      const current = await currentFile();
      const conflicts = Object.entries(legacy).some(
        ([key, text]) => key in current.fields && current.fields[key] !== text
      );
      if (
        conflicts &&
        !window.confirm(
          '本机旧稿与项目文件有不同内容。迁移会用本机的这些字段覆盖文件版本，是否继续？'
        )
      )
        return;
      await persist({ ...current.fields, ...legacy }, current);
      retireLocal();
    });
  };
  const pendingLegacy = Object.keys(legacy).length > 0;
  const failure = error || loadError || legacyError;
  const status = portable
    ? busy
      ? '正在应用修改…'
      : '独立 HTML · 修改后请保存新版文件'
    : busy
      ? '正在写入项目文件…'
      : loading
        ? '正在读取项目文件…'
        : document?.writable
          ? '内容已与项目文件同步 · 其他设备可读取'
          : '静态副本可查看；编辑保存需要运行演示服务';

  return (
    <EditorContext.Provider value={{ fields, editing, setEditing, select, canEdit, busy }}>
      <div className="mh-edit-surface" data-editing={editing}>
        {children}
        {(editing || loading || failure || pendingLegacy || !document?.writable) && (
          <aside className="mh-editor-dock" aria-label="文字编辑工具">
            <div>
              <strong>{editing ? '点击虚线框中的文字即可修改' : '演示内容文件'}</strong>
              <p role={failure ? 'alert' : 'status'} className={failure ? 'mh-editor-error' : ''}>
                {failure || status}
              </p>
              {pendingLegacy && (
                <div className="mh-local-migration">
                  <p>检测到未迁移的本机旧稿，尚未覆盖项目文件。</p>
                  <button type="button" disabled={!canEdit || busy} onClick={migrate}>
                    迁移本机修改
                  </button>
                  <button
                    type="button"
                    onClick={() => exportDraft(legacy, 'Mind-Harness-本机旧稿.json')}
                  >
                    导出本机旧稿
                  </button>
                </div>
              )}
            </div>
            <div className="mh-editor-actions">
              {portable && (
                <>
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={downloadPortablePresentation}
                  >
                    <Download size={15} />
                    保存新版 HTML
                  </button>
                  <a className="mh-portable-notes-link" href="#speaker-notes">
                    独立讲稿
                  </a>
                </>
              )}
              {loadError && (
                <button type="button" onClick={() => refreshRef.current()} disabled={busy}>
                  重新读取文件
                </button>
              )}
              <button
                type="button"
                onClick={undo}
                disabled={!canEdit || busy || history.length === 0}
              >
                <Undo2 size={15} />
                撤销
              </button>
              <button type="button" onClick={() => exportDraft()} disabled={!document || busy}>
                <Download size={15} />
                导出备份
              </button>
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                disabled={!canEdit || busy}
              >
                <Upload size={15} />
                导入备份
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={!editing || busy}>
                完成编辑
              </button>
            </div>
            <input
              ref={uploadRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="选择文字备份"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importDraft(file);
              }}
            />
          </aside>
        )}
        <dialog
          className="mh-text-editor"
          ref={dialogRef}
          aria-labelledby="mh-text-editor-title"
          onCancel={event => {
            if (busy) event.preventDefault();
            else setSelected(null);
          }}
        >
          <form
            onSubmit={event => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="mh-text-editor-heading">
              <h2 id="mh-text-editor-title">{selected?.label}</h2>
              <button
                type="button"
                aria-label="取消编辑"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <label htmlFor="mh-editor-value">文字内容</label>
            <textarea
              id="mh-editor-value"
              name="text"
              ref={textareaRef}
              value={value}
              disabled={busy}
              onChange={event => setValue(event.target.value)}
              rows={8}
              aria-describedby="mh-editor-help"
            />
            <p id="mh-editor-help">
              {portable
                ? '应用后保留在当前页面；请点击“保存新版 HTML”把修改保存为文件，再分享或关闭。'
                : '支持换行。点击应用后写入项目文件，其他设备读取同一份内容。'}
            </p>
            {failure && (
              <p className="mh-editor-error" role="alert">
                {failure}
              </p>
            )}
            <div className="mh-text-editor-actions">
              <button type="button" disabled={busy} onClick={() => apply(true)}>
                恢复这段原文
              </button>
              <span />
              <button type="button" disabled={busy} onClick={() => setSelected(null)}>
                取消
              </button>
              <button type="submit" disabled={busy || !canEdit} className="mh-editor-apply">
                {busy ? (portable ? '正在应用…' : '正在写入…') : '应用修改'}
              </button>
            </div>
          </form>
        </dialog>
      </div>
    </EditorContext.Provider>
  );
}
