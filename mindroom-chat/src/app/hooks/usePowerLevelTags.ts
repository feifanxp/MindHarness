import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';
import { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { IPowerLevels } from './usePowerLevels';
import { useStateEvent } from './useStateEvent';
import { MemberPowerTag, StateEvent } from '../../types/matrix/room';

export type PowerLevelTags = Record<number, MemberPowerTag>;

const powerSortFn = (a: number, b: number) => b - a;
const sortPowers = (powers: number[]): number[] => powers.sort(powerSortFn);

export const getPowers = (tags: PowerLevelTags): number[] => {
  const powers: number[] = Object.keys(tags)
    .map((p) => {
      const power = parseInt(p, 10);
      if (Number.isNaN(power)) {
        return undefined;
      }
      return power;
    })
    .filter((power): power is number => typeof power === 'number');

  return sortPowers(powers);
};

export const getUsedPowers = (powerLevels: IPowerLevels): Set<number> => {
  const powers: Set<number> = new Set();

  const findAndAddPower = (data: Record<string, unknown>) => {
    Object.keys(data).forEach((key) => {
      const powerOrAny: unknown = data[key];

      if (typeof powerOrAny === 'number') {
        powers.add(powerOrAny);
        return;
      }
      if (powerOrAny && typeof powerOrAny === 'object') {
        findAndAddPower(powerOrAny as Record<string, unknown>);
      }
    });
  };

  findAndAddPower(powerLevels);

  return powers;
};

const getDefaultTags = (t: TFunction): PowerLevelTags => ({
  9001: {
    name: 'Goku',
    color: '#ff6a00',
  },
  150: {
    name: t('sharedUi.powerLevels.manager'),
    color: '#ff6a7f',
  },
  101: {
    name: t('sharedUi.powerLevels.founder'),
    color: '#0000ff',
  },
  100: {
    name: t('sharedUi.powerLevels.admin'),
    color: '#0088ff',
  },
  50: {
    name: t('sharedUi.powerLevels.moderator'),
    color: '#1fd81f',
  },
  0: {
    name: t('sharedUi.powerLevels.member'),
    color: '#91cfdf',
  },
  [-1]: {
    name: t('sharedUi.powerLevels.muted'),
    color: '#888888',
  },
});

const generateFallbackTag = (
  powerLevelTags: PowerLevelTags,
  power: number,
  t: TFunction
): MemberPowerTag => {
  const highToLow = sortPowers(getPowers(powerLevelTags));

  const tagPower = highToLow.find((p) => p < power);
  const tag = typeof tagPower === 'number' ? powerLevelTags[tagPower] : undefined;

  return {
    name: tag ? `${tag.name} ${power}` : t('sharedUi.powerLevels.team', { power }),
  };
};

export const usePowerLevelTags = (room: Room, powerLevels: IPowerLevels): PowerLevelTags => {
  const { t } = useTranslation();
  const tagsEvent = useStateEvent(room, StateEvent.PowerLevelTags);

  const powerLevelTags: PowerLevelTags = useMemo(() => {
    const defaultTags = getDefaultTags(t);
    const content = tagsEvent?.getContent<PowerLevelTags>();
    const powerToTags: PowerLevelTags = { ...content };

    const powers = getUsedPowers(powerLevels);
    Array.from(powers).forEach((power) => {
      if (powerToTags[power]?.name === undefined) {
        powerToTags[power] = defaultTags[power] ?? generateFallbackTag(defaultTags, power, t);
      }
    });

    return powerToTags;
  }, [powerLevels, tagsEvent, t]);

  return powerLevelTags;
};

export const getPowerLevelTag = (
  powerLevelTags: PowerLevelTags,
  powerLevel: number,
  t: TFunction
): MemberPowerTag => {
  const tag: MemberPowerTag | undefined = powerLevelTags[powerLevel];
  return tag ?? generateFallbackTag(powerLevelTags, powerLevel, t);
};
