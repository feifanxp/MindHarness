import { useMemo } from 'react';
import { DateFormat } from '../state/settings';

export type DateFormatItem = {
  format: DateFormat;
};

export const useDateFormatItems = (): DateFormatItem[] =>
  useMemo(
    () => [
      { format: 'D MMM YYYY' },
      { format: 'DD/MM/YYYY' },
      { format: 'MM/DD/YYYY' },
      { format: 'YYYY/MM/DD' },
      { format: 'YYYY-MM-DD' },
      { format: '' },
    ],
    []
  );
