import React, { ReactNode } from 'react';
import { ClientRoot } from './ClientRoot';
import { ClientInitStorageAtom } from './ClientInitStorageAtom';
import { ClientRoomsNotificationPreferences } from './ClientRoomsNotificationPreferences';
import { ClientBindAtoms } from './ClientBindAtoms';
import { ClientNonUIFeatures } from './ClientNonUIFeatures';
import { CallEmbedProvider } from '../../components/CallEmbedProvider';
import { MindroomNavigationProvider } from '../../mindroom/sidebar/MindroomNavigation';
import { CallStatusRenderer } from '../CallStatusRenderer';
import { UserRoomProfileRenderer } from '../../components/UserRoomProfileRenderer';
import { CommandPaletteRenderer } from '../../mindroom/command-palette';
import { SettingsModalRenderer } from '../../features/settings';
import { CreateRoomModalRenderer } from '../../features/create-room';
import { CreateSpaceModalRenderer } from '../../features/create-space';
import { RoomSettingsRenderer } from '../../features/room-settings';
import { SpaceSettingsRenderer } from '../../features/space-settings';
import { ReceiveSelfDeviceVerification } from '../../components/DeviceVerification';
import { AutoRestoreBackupOnVerification } from '../../components/BackupRestore';

/** Share the existing account, sync and message runtime across both room layouts. */
export function ClientRuntime({ children }: { children: ReactNode }) {
  return (
    <ClientRoot>
      <ClientInitStorageAtom>
        <ClientRoomsNotificationPreferences>
          <ClientBindAtoms>
            <ClientNonUIFeatures>
              <CallEmbedProvider>
                <MindroomNavigationProvider>{children}</MindroomNavigationProvider>
                <CallStatusRenderer />
                <UserRoomProfileRenderer />
              </CallEmbedProvider>
              <CommandPaletteRenderer />
              <SettingsModalRenderer />
              <CreateRoomModalRenderer />
              <CreateSpaceModalRenderer />
              <RoomSettingsRenderer />
              <SpaceSettingsRenderer />
              <ReceiveSelfDeviceVerification />
              <AutoRestoreBackupOnVerification />
            </ClientNonUIFeatures>
          </ClientBindAtoms>
        </ClientRoomsNotificationPreferences>
      </ClientInitStorageAtom>
    </ClientRoot>
  );
}
