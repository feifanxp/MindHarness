import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Icon, IconButton, Icons } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n';
import { DarkTheme, LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { CompactThreadCard } from '../../src/app/mindroom/threads/CompactThreadCard';
import { CompactCardSwipe } from '../../src/app/mindroom/threads/CompactCardSwipe';
import {
  formatCompactThreadMessageCount,
  getCompactThreadMessageCountLabel,
} from '../../src/app/mindroom/threads/compactThreadCardViewModel';
import * as css from '../../src/app/mindroom/threads/CompactRoomView.css';
import type { CompactThreadCardViewModel } from '../../src/app/mindroom/threads/types';

// Screenshot fixture for the compact room view: a realistic agent room with
// unread, streaming, scheduled, tagged and resolved threads, rendered by the
// production card inside the same shell, swipe and action buttons as
// CompactRoomView. A swipe toggles a card's resolution; opening a card records
// its thread in `body[data-opened-thread]`.
// Query parameters: `lang` (default en) and `theme` (light or dark).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(params.get('theme') === 'dark' ? DarkTheme : LightTheme);

const avatar = (background: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${background}"/><text x="16" y="21" font-size="15" text-anchor="middle" font-family="sans-serif" fill="white">${label}</text></svg>`
  )}`;

const mind = {
  userId: '@mindroom_mind:example.org',
  displayName: 'Mind',
  avatarUrl: avatar('#e07a5f', '🧠'),
};
const bas = { userId: '@bas:example.org', displayName: 'Bas', avatarUrl: avatar('#3d405b', 'B') };

const minutes = (count: number) => Date.now() - count * 60_000;
const days = (count: number) => Date.now() - count * 86_400_000 - 3_600_000;

type Sample = {
  title: string;
  tools?: number;
  preview: string;
  messageCount: number;
  lastActivityTs: number;
  participants?: typeof mind[];
  tags?: string[];
  isUnread?: boolean;
  isStreaming?: boolean;
  isResolved?: boolean;
  scheduled?: string;
};

const samples: Sample[] = [
  {
    title: '🎙️ Delegated Codex investigation of agent barge-in overtalk in MindRoom voice calls',
    tools: 11,
    preview: 'Report is committed. Reading it now and summarising the three root causes.',
    messageCount: 7,
    lastActivityTs: minutes(1),
    isStreaming: true,
    isUnread: true,
  },
  {
    title: '📝 Drafting a follow-up blog post on dependency thresholds and MindRoom evidence',
    tools: 4,
    preview: "Here's the full draft, rewritten around the threshold evidence you sent.",
    messageCount: 25,
    lastActivityTs: days(2),
    participants: [mind, bas],
    tags: ['blog', 'mindroom'],
    isUnread: true,
  },
  {
    title: '🔎 Config lookup for Vonk agent Matrix username',
    tools: 1,
    preview: "Sleutel's Matrix username is @mindroom_sleutel:mindroom.chat.",
    messageCount: 4,
    lastActivityTs: days(2),
    participants: [mind, bas],
  },
  {
    title: '🔍 Chase transaction review for fraud, duplicates, and unusual charges',
    tools: 2,
    preview: 'Sounds like a nightmare. The good news is that both charges are refundable.',
    messageCount: 5,
    lastActivityTs: days(3),
    participants: [mind, bas],
    scheduled: 'ma 09:00',
  },
  {
    title:
      'ISSUE-307: voice-call turn died with an Anthropic invalid_request_error about thinking blocks in the latest assistant message. Delegated to Codex gpt-6-astra for a fix',
    tools: 6,
    preview: 'The poke loop is waking on a todo that was already closed.',
    messageCount: 11,
    lastActivityTs: days(5),
    participants: [mind],
    tags: ['issue-307', 'mindroom'],
  },
  {
    title:
      '🔍 ISSUE-303 investigation of list_thread_tags vs Cinny unresolved-thread count mismatch',
    tools: 3,
    preview: 'Both counts now agree after the cache fix.',
    messageCount: 9,
    lastActivityTs: days(5),
    participants: [mind, bas],
    isResolved: true,
  },
];

const toViewModel = (sample: Sample, index: number): CompactThreadCardViewModel => {
  const toolBadge = sample.tools
    ? `🔧 ${i18n.t('sharedUi.threadPreviews.tools', { count: sample.tools })} · `
    : '';
  return {
    id: { roomId: '!personal:example.org', threadRootId: `$thread-${index}` },
    titleText: sample.title,
    displayTitleText: sample.title,
    previewText: `Mind: ${toolBadge}${sample.preview}`,
    messageCount: sample.messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(
      sample.messageCount,
      i18n.t,
      i18n.language
    ),
    messageCountText: formatCompactThreadMessageCount(sample.messageCount, i18n.language),
    attentionState: sample.isResolved
      ? 'resolved'
      : sample.isStreaming
      ? 'streaming'
      : 'needs-attention',
    attentionStatusText: '',
    participants: sample.participants ?? [mind],
    tags: sample.tags ?? [],
    isResolved: sample.isResolved === true,
    resolvedByDisplayName: sample.isResolved ? 'Bas' : undefined,
    isUnread: sample.isUnread === true,
    isStreaming: sample.isStreaming === true,
    scheduledDisplayText: sample.scheduled,
    scheduledTaskLabel: sample.scheduled ? `Next task ${sample.scheduled}` : undefined,
    lastActivityTs: sample.lastActivityTs,
    lastActivityTitle: new Date(sample.lastActivityTs).toLocaleString(i18n.language),
  };
};

const openThread = (threadRootId: string) => {
  document.body.dataset.openedThread = threadRootId;
};

function Fixture() {
  const [items, setItems] = useState(samples);
  const setResolved = (index: number, isResolved: boolean) =>
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, isResolved } : item))
    );

  return (
    <Box className={css.View} data-compact-room-view="true" style={{ flex: 'none' }}>
      <Box direction="Column" gap="100" shrink="No">
        {items.map(toViewModel).map((viewModel, index) => (
          <div key={viewModel.id.threadRootId} className={css.CardShell}>
            <CompactCardSwipe
              enabled
              resolved={viewModel.isResolved}
              label={i18n.t(viewModel.isResolved ? 'threadActions.reopen' : 'thread.resolve')}
              onSwipe={(wasResolved) => setResolved(index, !wasResolved)}
            >
              <CompactThreadCard viewModel={viewModel} onClick={openThread} />
              <div className={css.CardAction}>
                <IconButton
                  className={css.CardQuickAction}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="Resolve"
                >
                  <Icon size="100" src={Icons.Check} />
                </IconButton>
                <IconButton
                  className={css.CardQuickAction}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="Pin"
                >
                  <Icon size="100" src={Icons.Pin} />
                </IconButton>
                <IconButton
                  className={css.CardMenuButton}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="More options"
                >
                  <Icon size="100" src={Icons.HorizontalDots} />
                </IconButton>
              </div>
            </CompactCardSwipe>
          </div>
        ))}
      </Box>
    </Box>
  );
}

i18n.changeLanguage(params.get('lang') ?? 'en').then(async () => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
