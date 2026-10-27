import { useEffect, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { deleteAfterLoginRedirectPath, getAfterLoginRedirectPath } from '../afterLoginRedirectPath';
import { getHomePath } from '../pathUtils';
import { putSession } from '../../state/sessions';

export type CompletedSession = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
};

const completeSession = (session: CompletedSession, navigate: NavigateFunction): boolean => {
  try {
    putSession(session);
  } catch {
    return false;
  }

  // Add-account flows honor a saved return path too, so a page that sends the
  // user to add an account (such as device pairing) gets them back afterwards.
  const afterLoginRedirectPath = getAfterLoginRedirectPath();
  deleteAfterLoginRedirectPath();
  navigate(afterLoginRedirectPath ?? getHomePath(), { replace: true });
  return true;
};

export const useSessionCompletion = (session: CompletedSession | undefined): boolean => {
  const navigate = useNavigate();
  const [sessionStoreError, setSessionStoreError] = useState(false);

  useEffect(() => {
    if (!session) return;
    setSessionStoreError(false);
    if (!completeSession(session, navigate)) {
      setSessionStoreError(true);
    }
  }, [session, navigate]);

  return sessionStoreError;
};
