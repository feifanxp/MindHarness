import React, { useCallback, useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, Switch, Button } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import {
  AccountDataEditor,
  AccountDataSubmitCallback,
} from '../../../components/AccountDataEditor';
import { copyToClipboard } from '../../../utils/dom';
import { AccountData } from './AccountData';

type DeveloperToolsProps = {
  requestClose: () => void;
};
export function DeveloperTools({ requestClose }: DeveloperToolsProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [developerTools, setDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const [expand, setExpend] = useState(false);
  const [accountDataType, setAccountDataType] = useState<string | null>();

  const submitAccountData: AccountDataSubmitCallback = useCallback(
    async (type, content) => {
      await mx.setAccountData(type as any, content as any);
    },
    [mx]
  );

  if (accountDataType !== undefined) {
    return (
      <AccountDataEditor
        type={accountDataType ?? undefined}
        content={
          accountDataType ? mx.getAccountData(accountDataType as any)?.getContent() : undefined
        }
        submitChange={submitAccountData}
        requestClose={() => setAccountDataType(undefined)}
      />
    );
  }

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.settings.developerTools.developTools.developerTools')}
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
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.settings.developerTools.developTools.options')}</Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title={t('featureUi.settings.developerTools.developTools.enableDeveloperTools')}
                  after={
                    <Switch variant="Primary" value={developerTools} onChange={setDeveloperTools} />
                  }
                />
              </SequenceCard>
              {developerTools && (
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title={t('featureUi.settings.developerTools.developTools.accessToken')}
                    description={t(
                      'featureUi.settings.developerTools.developTools.copyAccessTokenToClipboard'
                    )}
                    after={
                      <Button
                        onClick={() =>
                          copyToClipboard(mx.getAccessToken() ?? '<NO_ACCESS_TOKEN_FOUND>')
                        }
                        variant="Secondary"
                        fill="Soft"
                        size="300"
                        radii="300"
                        outlined
                      >
                        <Text size="B300">
                          {t('featureUi.settings.developerTools.developTools.copy')}
                        </Text>
                      </Button>
                    }
                  />
                </SequenceCard>
              )}
            </Box>
            {developerTools && (
              <AccountData
                expand={expand}
                onExpandToggle={setExpend}
                onSelect={setAccountDataType}
              />
            )}
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
