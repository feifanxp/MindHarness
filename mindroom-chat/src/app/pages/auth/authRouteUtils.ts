import { generatePath, matchPath } from 'react-router-dom';
import { LOGIN_PATH, REGISTER_PATH, RESET_PASSWORD_PATH } from '../paths';

export const currentAuthPath = (pathname: string, registrationAllowed: boolean): string => {
  if (matchPath(LOGIN_PATH, pathname)) {
    return LOGIN_PATH;
  }
  if (matchPath(RESET_PASSWORD_PATH, pathname)) {
    return RESET_PASSWORD_PATH;
  }
  if (registrationAllowed && matchPath(REGISTER_PATH, pathname)) {
    return REGISTER_PATH;
  }
  return LOGIN_PATH;
};

export const buildAuthRoutePath = ({
  pathname,
  search,
  hash,
  registrationAllowed,
  server,
}: {
  pathname: string;
  search?: string;
  hash?: string;
  registrationAllowed: boolean;
  server: string;
}): string => {
  const path = generatePath(currentAuthPath(pathname, registrationAllowed), {
    server: encodeURIComponent(server),
  });

  return `${path}${search ?? ''}${hash ?? ''}`;
};
