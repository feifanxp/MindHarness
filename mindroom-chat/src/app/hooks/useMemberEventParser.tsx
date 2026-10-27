import { Trans, useTranslation } from 'react-i18next';
import React, { ReactNode } from 'react';
import { IconSrc, Icons } from 'folds';
import { MatrixEvent } from 'matrix-js-sdk';
import { IMemberContent, Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';
import { isMembershipChanged } from '../utils/room';

export type ParsedResult = {
  icon: IconSrc;
  body: ReactNode;
};

export type MemberEventParser = (mEvent: MatrixEvent) => ParsedResult;

export const useMemberEventParser = (): MemberEventParser => {
  const { t } = useTranslation();
  const parseMemberEvent: MemberEventParser = (mEvent) => {
    const content = mEvent.getContent<IMemberContent>();
    const prevContent = mEvent.getPrevContent() as IMemberContent;
    const senderId = mEvent.getSender();
    const userId = mEvent.getStateKey();
    const reason = typeof content.reason === 'string' ? content.reason : undefined;

    if (!senderId || !userId)
      return {
        icon: Icons.User,
        body: t('sharedUi.memberEvents.broken'),
      };

    const senderName = getMxIdLocalPart(senderId);
    const userName =
      typeof content.displayname === 'string'
        ? content.displayname || getMxIdLocalPart(userId)
        : getMxIdLocalPart(userId);

    if (isMembershipChanged(mEvent)) {
      if (content.membership === Membership.Invite) {
        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightPlus,
            body: (
              <Trans
                t={t}
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="sharedUi.memberEvents.acceptedRequest"
                values={{ senderName, userName, reason: reason ?? '' }}
                components={{ b: <b /> }}
              />
            ),
          };
        }

        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.invited"
              values={{ senderName, userName, reason: reason ?? '' }}
              components={{ b: <b /> }}
            />
          ),
        };
      }

      if (content.membership === Membership.Knock) {
        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.requested"
              values={{ userName, reason: reason ?? '' }}
              components={{ b: <b /> }}
            />
          ),
        };
      }

      if (content.membership === Membership.Join) {
        return {
          icon: Icons.ArrowGoRight,
          body: (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.joined"
              values={{ userName }}
              components={{ b: <b /> }}
            />
          ),
        };
      }

      if (content.membership === Membership.Leave) {
        if (prevContent.membership === Membership.Invite) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="sharedUi.memberEvents.rejectedInvitation"
                  values={{ userName, reason: reason ?? '' }}
                  components={{ b: <b /> }}
                />
              ) : (
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="sharedUi.memberEvents.rejectedRequest"
                  values={{ senderName, userName, reason: reason ?? '' }}
                  components={{ b: <b /> }}
                />
              ),
          };
        }

        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="sharedUi.memberEvents.withdrewRequest"
                  values={{ userName, reason: reason ?? '' }}
                  components={{ b: <b /> }}
                />
              ) : (
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="sharedUi.memberEvents.revokedInvitation"
                  values={{ senderName, userName, reason: reason ?? '' }}
                  components={{ b: <b /> }}
                />
              ),
          };
        }

        if (prevContent.membership === Membership.Ban) {
          return {
            icon: Icons.ArrowGoLeft,
            body: (
              <Trans
                t={t}
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="sharedUi.memberEvents.unbanned"
                values={{ senderName, userName, reason: reason ?? '' }}
                components={{ b: <b /> }}
              />
            ),
          };
        }

        return {
          icon: Icons.ArrowGoLeft,
          body:
            senderId === userId ? (
              <Trans
                t={t}
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="sharedUi.memberEvents.left"
                values={{ userName, reason: reason ?? '' }}
                components={{ b: <b /> }}
              />
            ) : (
              <Trans
                t={t}
                shouldUnescape
                tOptions={{ interpolation: { escapeValue: true } }}
                i18nKey="sharedUi.memberEvents.kicked"
                values={{ senderName, userName, reason: reason ?? '' }}
                components={{ b: <b /> }}
              />
            ),
        };
      }

      if (content.membership === Membership.Ban) {
        return {
          icon: Icons.ArrowGoLeft,
          body: (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.banned"
              values={{ senderName, userName, reason: reason ?? '' }}
              components={{ b: <b /> }}
            />
          ),
        };
      }
    }

    if (content.displayname !== prevContent.displayname) {
      const prevUserName =
        typeof prevContent.displayname === 'string'
          ? prevContent.displayname || getMxIdLocalPart(userId)
          : getMxIdLocalPart(userId);

      return {
        icon: Icons.Mention,
        body:
          typeof content.displayname === 'string' ? (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.changedName"
              values={{ prevUserName, userName }}
              components={{ b: <b /> }}
            />
          ) : (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.removedName"
              values={{ prevUserName }}
              components={{ b: <b /> }}
            />
          ),
      };
    }
    if (content.avatar_url !== prevContent.avatar_url) {
      return {
        icon: Icons.User,
        body:
          content.avatar_url && typeof content.avatar_url === 'string' ? (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.changedAvatar"
              values={{ userName }}
              components={{ b: <b /> }}
            />
          ) : (
            <Trans
              t={t}
              shouldUnescape
              tOptions={{ interpolation: { escapeValue: true } }}
              i18nKey="sharedUi.memberEvents.removedAvatar"
              values={{ userName }}
              components={{ b: <b /> }}
            />
          ),
      };
    }

    return {
      icon: Icons.User,
      body: t('sharedUi.memberEvents.unchanged'),
    };
  };

  return parseMemberEvent;
};
