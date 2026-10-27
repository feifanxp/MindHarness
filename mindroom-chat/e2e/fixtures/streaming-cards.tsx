import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { lightTheme } from '../../src/colors.css';
import { CompactThreadCard } from '../../src/app/mindroom/threads/CompactThreadCard';
import type { CompactThreadCardViewModel } from '../../src/app/mindroom/threads/types';

document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;
const cards: CompactThreadCardViewModel[] = Array.from({ length: 200 }, (_, index) => ({
  id: { roomId: '!room:example.org', threadRootId: `$thread-${index}` },
  titleText: `Task ${index}`,
  displayTitleText: `Task ${index}`,
  previewText: 'An agent is streaming a response.',
  messageCount: 1,
  messageCountLabel: '1 msg',
  messageCountText: '1',
  attentionState: 'streaming',
  attentionStatusText: 'Agent streaming',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: true,
}));

function Fixture() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setMounted(!mounted)}>
        Toggle cards
      </button>
      <main data-scroller style={{ height: 400, overflow: 'auto', width: 360 }}>
        {mounted &&
          cards.map((viewModel) => (
            <CompactThreadCard
              key={viewModel.id.threadRootId}
              viewModel={viewModel}
              onClick={() => undefined}
            />
          ))}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
