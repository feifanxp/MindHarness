import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { MemberPowerTag } from '../../types/matrix/room';

const DEFAULT_TAG: MemberPowerTag = {
  name: 'Founder',
  color: '#0000ff',
};

export const useRoomCreatorsTag = (): MemberPowerTag => {
  const { t } = useTranslation();
  return useMemo(() => ({ ...DEFAULT_TAG, name: t('sharedUi.powerLevels.founder') }), [t]);
};
