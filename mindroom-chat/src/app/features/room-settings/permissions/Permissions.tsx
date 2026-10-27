import React, { useState } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { useRoom } from '../../../hooks/useRoom';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { StateEvent } from '../../../../types/matrix/room';
import { usePermissionGroups } from './usePermissionItems';
import { PermissionGroups, Powers, PowersEditor } from '../../common-settings/permissions';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';

type PermissionsProps = {
  requestClose: () => void;
};
export function Permissions({ requestClose }: PermissionsProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);

  const canEditPowers = permissions.stateEvent(StateEvent.PowerLevelTags, mx.getSafeUserId());
  const canEditPermissions = permissions.stateEvent(StateEvent.RoomPowerLevels, mx.getSafeUserId());
  const permissionGroups = usePermissionGroups();

  const [powerEditor, setPowerEditor] = useState(false);

  const handleEditPowers = () => {
    setPowerEditor(true);
  };

  if (canEditPowers && powerEditor) {
    return <PowersEditor powerLevels={powerLevels} requestClose={() => setPowerEditor(false)} />;
  }

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.roomSettings.permissions.permissions')}
                </Text>
              </Box>
              <Box shrink="No">
                <IconButton onClick={requestClose} variant="Surface">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            <Powers
              powerLevels={powerLevels}
              onEdit={canEditPowers ? handleEditPowers : undefined}
              permissionGroups={permissionGroups}
            />
            <PermissionGroups
              canEdit={canEditPermissions}
              powerLevels={powerLevels}
              permissionGroups={permissionGroups}
            />
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
