import to from 'await-to-js';
import {
  IAuthData,
  MatrixClient,
  MatrixError,
  RegisterRequest,
  RegisterResponse,
} from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginPathSearchParams } from '../../paths';
import { ErrorCode } from '../../../cs-errorcode';
import { getLoginPath, withSearchParam } from '../../pathUtils';
import { getMxIdLocalPart, getMxIdServer } from '../../../utils/matrix';
import { useSessionCompletion, type CompletedSession } from '../sessionCompletion';
import { withAddAccountSearchIf } from '../addAccount';

export enum RegisterError {
  UserTaken = 'UserTaken',
  UserInvalid = 'UserInvalid',
  UserExclusive = 'UserExclusive',
  PasswordWeak = 'PasswordWeak',
  PasswordShort = 'PasswordShort',
  InvalidRequest = 'InvalidRequest',
  Forbidden = 'Forbidden',
  RateLimited = 'RateLimited',
  Unknown = 'Unknown',
}

export type CustomRegisterResponse = {
  baseUrl: string;
  response: RegisterResponse;
};
export type RegisterResult = [IAuthData, undefined] | [undefined, CustomRegisterResponse];
export const register = async (
  mx: MatrixClient,
  requestData: RegisterRequest
): Promise<RegisterResult> => {
  const [err, res] = await to<RegisterResponse, MatrixError>(
    mx.registerRequest({ ...requestData, refresh_token: true })
  );

  if (err) {
    if (err.httpStatus === 401) {
      const authData = err.data as IAuthData;
      return [authData, undefined];
    }

    if (err.errcode === ErrorCode.M_USER_IN_USE) {
      throw new MatrixError({
        errcode: RegisterError.UserTaken,
      });
    }
    if (err.errcode === ErrorCode.M_INVALID_USERNAME) {
      throw new MatrixError({
        errcode: RegisterError.UserInvalid,
      });
    }
    if (err.errcode === ErrorCode.M_EXCLUSIVE) {
      throw new MatrixError({
        errcode: RegisterError.UserExclusive,
      });
    }
    if (err.errcode === ErrorCode.M_WEAK_PASSWORD) {
      throw new MatrixError({
        errcode: RegisterError.PasswordWeak,
        error: err.data.error,
      });
    }
    if (err.errcode === ErrorCode.M_PASSWORD_TOO_SHORT) {
      throw new MatrixError({
        errcode: RegisterError.PasswordShort,
        error: err.data.error,
      });
    }

    if (err.httpStatus === 429) {
      throw new MatrixError({
        errcode: RegisterError.RateLimited,
      });
    }

    if (err.httpStatus === 400) {
      throw new MatrixError({
        errcode: RegisterError.InvalidRequest,
      });
    }

    if (err.httpStatus === 403) {
      throw new MatrixError({
        errcode: RegisterError.Forbidden,
      });
    }

    throw new MatrixError({
      errcode: RegisterError.Unknown,
      error: err.data.error,
    });
  }
  return [
    undefined,
    {
      baseUrl: mx.baseUrl,
      response: res,
    },
  ];
};

export const useRegisterComplete = (data?: CustomRegisterResponse, addAccount = false) => {
  const navigate = useNavigate();

  const session = useMemo<CompletedSession | undefined>(() => {
    if (!data) return undefined;
    const { response, baseUrl } = data;
    if (!response.access_token || !response.device_id) return undefined;
    return {
      accessToken: response.access_token,
      deviceId: response.device_id,
      userId: response.user_id,
      baseUrl,
      expiresInMs: response.expires_in_ms,
      refreshToken: response.refresh_token,
    };
  }, [data]);

  const sessionStoreError = useSessionCompletion(session);

  useEffect(() => {
    if (!data || session) return;
    const userId = data.response.user_id;
    const username = getMxIdLocalPart(userId);
    const userServer = getMxIdServer(userId);
    navigate(
      withSearchParam<LoginPathSearchParams>(
        withAddAccountSearchIf(getLoginPath(userServer), addAccount),
        {
          username,
        }
      ),
      { replace: true }
    );
  }, [addAccount, data, session, navigate]);

  return sessionStoreError;
};
