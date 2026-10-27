import { useMatch } from 'react-router-dom';
import { getThreadsPath } from '../../pages/pathUtils';

export const useThreadsSelected = (): boolean => {
  const match = useMatch({
    path: getThreadsPath(),
    caseSensitive: true,
    end: false,
  });

  return !!match;
};
