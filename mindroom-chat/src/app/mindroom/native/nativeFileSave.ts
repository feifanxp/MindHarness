import { Capacitor, registerPlugin } from '@capacitor/core';
import FileSaver from 'file-saver';

type MindRoomFileSavePlugin = {
  beginSave(options: { fileName: string; pageId: string }): Promise<{ id: string }>;
  appendSave(options: { id: string; data: string }): Promise<void>;
  presentSave(options: { id: string }): Promise<{ saved: boolean }>;
  abortSave(options: { id: string }): Promise<void>;
};

const NATIVE_SAVE_CHUNK_SIZE = 256 * 1024;

let mindRoomFileSavePlugin: MindRoomFileSavePlugin | undefined;
let nativeSavePageId: string | undefined;

const getMindRoomFileSavePlugin = (): MindRoomFileSavePlugin => {
  if (!mindRoomFileSavePlugin) {
    mindRoomFileSavePlugin = registerPlugin<MindRoomFileSavePlugin>('MindRoomFileSave');
  }

  return mindRoomFileSavePlugin;
};

const getNativeSavePageId = (): string => {
  if (!nativeSavePageId) {
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      bytes.forEach((_, index) => {
        bytes[index] = Math.floor(Math.random() * 256);
      });
    }
    nativeSavePageId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return nativeSavePageId;
};

const isNativeIOSFileSaveAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomFileSave');

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Failed to encode attachment'));
        return;
      }

      const separator = dataUrl.indexOf(',');
      if (separator === -1) {
        reject(new Error('Failed to encode attachment'));
        return;
      }

      resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });

const sourceToBlob = async (source: Blob | string): Promise<Blob> => {
  if (source instanceof Blob) return source;

  const response = await fetch(source);
  if (!response.ok) throw new Error(`Failed to read attachment (${response.status})`);
  return response.blob();
};

/**
 * Save a downloaded file using the platform's native destination picker on
 * iOS. Other platforms retain FileSaver's existing browser behavior.
 */
export const saveFile = async (source: Blob | string, fileName: string): Promise<boolean> => {
  if (!isNativeIOSFileSaveAvailable()) {
    FileSaver.saveAs(source, fileName);
    return true;
  }

  const blob = await sourceToBlob(source);
  const plugin = getMindRoomFileSavePlugin();
  let saveId: string | undefined;

  try {
    const session = await plugin.beginSave({ fileName, pageId: getNativeSavePageId() });
    saveId = session.id;

    for (let offset = 0; offset < blob.size; offset += NATIVE_SAVE_CHUNK_SIZE) {
      const chunk = blob.slice(offset, offset + NATIVE_SAVE_CHUNK_SIZE);
      const data = await blobToBase64(chunk);
      await plugin.appendSave({ id: saveId, data });
    }

    const result = await plugin.presentSave({ id: saveId });
    return result.saved;
  } catch (error) {
    if (saveId) {
      await plugin.abortSave({ id: saveId }).catch(() => undefined);
    }
    throw error;
  }
};
