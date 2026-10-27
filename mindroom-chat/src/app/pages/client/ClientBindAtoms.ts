import { ReactNode, useEffect, useState } from 'react';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useBindAtoms } from '../../state/hooks/useBindAtoms';

type ClientBindAtomsProps = {
  children: ReactNode;
};
export function ClientBindAtoms({ children }: ClientBindAtomsProps) {
  const mx = useMatrixClient();
  useBindAtoms(mx);
  const [boundClient, setBoundClient] = useState<typeof mx>();

  // useBindAtoms registers its initialization effects before this one. React
  // flushes those atom writes before the next render, so account UI never
  // commits with values left in the shared store by the previous client.
  useEffect(() => {
    setBoundClient(mx);
  }, [mx]);

  return boundClient === mx ? children : null;
}
