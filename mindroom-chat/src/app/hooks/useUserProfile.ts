import { useEffect, useState } from 'react';
import { UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

export type UserProfile = {
  avatarUrl?: string;
  displayName?: string;
  isAvatarResolved: boolean;
  isDisplayNameResolved: boolean;
};
export const useUserProfile = (userId: string): UserProfile => {
  const mx = useMatrixClient();

  const [profile, setProfile] = useState<UserProfile>(() => {
    const user = mx.getUser(userId);
    return {
      avatarUrl: user?.avatarUrl,
      displayName: user?.displayName,
      isAvatarResolved: false,
      isDisplayNameResolved: false,
    };
  });

  useEffect(() => {
    const user = mx.getUser(userId);
    const onAvatarChange: UserEventHandlerMap[UserEvent.AvatarUrl] = (event, myUser) => {
      setProfile((cp) => ({
        ...cp,
        avatarUrl: myUser.avatarUrl,
        isAvatarResolved: true,
      }));
    };
    const onDisplayNameChange: UserEventHandlerMap[UserEvent.DisplayName] = (event, myUser) => {
      setProfile((cp) => ({
        ...cp,
        displayName: myUser.displayName,
        isDisplayNameResolved: true,
      }));
    };

    let disposed = false;
    mx.getProfileInfo(userId)
      .then((info) => {
        if (disposed) return;
        setProfile({
          avatarUrl: info.avatar_url,
          displayName: info.displayname,
          isAvatarResolved: true,
          isDisplayNameResolved: true,
        });
      })
      .catch(() => undefined);

    user?.on(UserEvent.AvatarUrl, onAvatarChange);
    user?.on(UserEvent.DisplayName, onDisplayNameChange);
    return () => {
      disposed = true;
      user?.removeListener(UserEvent.AvatarUrl, onAvatarChange);
      user?.removeListener(UserEvent.DisplayName, onDisplayNameChange);
    };
  }, [mx, userId]);

  return profile;
};
