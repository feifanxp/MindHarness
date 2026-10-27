import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pluginSource = readFileSync(
  new URL('../../../../ios/App/App/MindRoomFileSavePlugin.swift', import.meta.url),
  'utf8'
);

const requireSourceMatch = (source: string, pattern: RegExp, label: string): string => {
  const match = source.match(pattern)?.[0];
  if (!match) throw new Error(`MindRoomFileSavePlugin is missing ${label}`);
  return match;
};

const presentSaveSource = requireSourceMatch(
  pluginSource,
  /@objc\s+func\s+presentSave\b[\s\S]*?(?=\n\s*@objc\s+func\s+abortSave\b)/,
  'presentSave'
);
const presentationCompletionSource = requireSourceMatch(
  presentSaveSource,
  /viewController\.present\(\s*picker[\s\S]*/,
  'picker presentation completion'
);

describe('MindRoomFileSavePlugin iOS export contract', () => {
  it('exports a copy of the disposable staged file into the selected destination', () => {
    expect(pluginSource).toMatch(
      /UIDocumentPickerViewController\(\s*forExporting:\s*\[\s*session\.fileURL\s*\],\s*asCopy:\s*true\s*\)/
    );
    expect(pluginSource).not.toMatch(/asCopy:\s*false/);
  });

  it('waits for picker presentation to finish before testing its window', () => {
    expect(presentationCompletionSource).toMatch(
      /viewController\.present\(picker,\s*animated:\s*true\)\s*\{\s*\[weak self,\s*weak picker\]\s*in[\s\S]*?picker\.viewIfLoaded\?\.window/
    );
    expect(presentationCompletionSource).toMatch(
      /activePickerSessionID\s*==\s*session\.id[\s\S]*?rejectPresentationUnavailable\(sessionID:\s*session\.id\)/
    );
    expect(presentationCompletionSource).not.toContain('DispatchQueue.main.async');
  });
});
