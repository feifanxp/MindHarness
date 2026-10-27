import React from 'react';
import { useAtom } from 'jotai';
import { Modal500 } from '../../components/Modal500';
import { settingsModalAtom } from '../../state/settingsModal';
import { Settings } from './Settings';

export function SettingsModalRenderer() {
  const [state, setState] = useAtom(settingsModalAtom);

  if (!state) return null;

  const closeSettings = () => setState(undefined);

  return (
    <Modal500 requestClose={closeSettings}>
      <Settings
        key={state.requestId}
        initialPage={state.initialPage}
        requestClose={closeSettings}
      />
    </Modal500>
  );
}
