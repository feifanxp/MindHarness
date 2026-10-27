export const APPSTORE_FIXTURE_ROOM_ALIAS = '#mindroom-app-store-personal-showcase:matrix.localhost';
export const APPSTORE_FIXTURE_ROOM_NAME = 'Family';
export const APPSTORE_FIXTURE_ROOM_TOPIC = 'The Rivera household';
export const APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME = 'Sam Rivera';
export const APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH =
  'scripts/fixtures/appstore/avatars/sam.png';

export const APPSTORE_FIXTURE_AGENT_PASSWORD = 'Pwappstoreagent123!';

const TOOL_MARKER_PATTERN = /^\s*🔧\s+`([^`]+)`\s+\[(\d+)\](?:\s+(⏳))?\s*$/u;

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInlineMarkdown = (value) => {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match = pattern.exec(value);

  while (match !== null) {
    if (match.index > cursor) {
      parts.push(escapeHtml(value.slice(cursor, match.index)));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else {
      parts.push(`<strong>${escapeHtml(token.slice(2, -2))}</strong>`);
    }
    cursor = match.index + token.length;
    match = pattern.exec(value);
  }

  if (cursor < value.length) {
    parts.push(escapeHtml(value.slice(cursor)));
  }

  return parts.join('');
};

export const bodyToFormattedHtml = (body) => {
  const htmlParts = [];
  let paragraphLines = [];
  let bulletItems = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    htmlParts.push(`<p>${paragraphLines.map(renderInlineMarkdown).join('<br/>')}</p>`);
    paragraphLines = [];
  };

  const flushBulletList = () => {
    if (bulletItems.length === 0) return;
    htmlParts.push(
      `<ul>${bulletItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`
    );
    bulletItems = [];
  };

  body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line) => {
      const toolMarker = TOOL_MARKER_PATTERN.exec(line);
      if (toolMarker) {
        flushParagraph();
        flushBulletList();
        htmlParts.push(
          `<p>🔧 <code>${escapeHtml(toolMarker[1])}</code> [${toolMarker[2]}]${
            toolMarker[3] ? ' ⏳' : ''
          }</p>`
        );
        return;
      }

      if (line.trim() === '') {
        flushParagraph();
        flushBulletList();
        return;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushBulletList();
        const level = Math.min(heading[1].length, 6);
        htmlParts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }

      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        flushParagraph();
        bulletItems.push(bullet[1]);
        return;
      }

      flushBulletList();
      paragraphLines.push(line);
    });

  flushParagraph();
  flushBulletList();
  return htmlParts.join('');
};

export const textMessage = (body, extraContent = {}) => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: bodyToFormattedHtml(body),
  ...extraContent,
});

export const noticeMessage = (body, extraContent = {}) => ({
  msgtype: 'm.notice',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: bodyToFormattedHtml(body),
  ...extraContent,
});

const buildAiRunMetadata = ({ runId, toolCount = 0, outputTokens = 0, modelConfig = 'astra' }) => ({
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    run_id: runId,
    model: {
      provider: modelConfig === 'opus' ? 'anthropic' : 'openai',
      id: modelConfig === 'opus' ? 'claude-opus-5-5' : 'gpt-6-astra',
      config: modelConfig,
    },
    usage: {
      input_tokens: 1280,
      output_tokens: outputTokens,
      total_tokens: 1280 + outputTokens,
      time_to_first_token: 1,
    },
    tools: {
      count: toolCount,
    },
  },
  'io.mindroom.stream_status': 'completed',
});

const buildToolTraceMetadata = (events) => ({
  'io.mindroom.tool_trace': {
    version: 2,
    events,
  },
});

export const getAppStoreFixtureAgentDefinitions = () => [
  {
    key: 'hearth',
    username: 'mindroom_hearth',
    password: APPSTORE_FIXTURE_AGENT_PASSWORD,
    displayName: 'Hearth',
    avatarAssetPath: 'scripts/fixtures/appstore/avatars/hearth.png',
  },
  {
    key: 'pantry',
    username: 'mindroom_pantry',
    password: APPSTORE_FIXTURE_AGENT_PASSWORD,
    displayName: 'Pantry',
    avatarAssetPath: 'scripts/fixtures/appstore/avatars/pantry.png',
  },
  {
    key: 'atlas',
    username: 'mindroom_atlas',
    password: APPSTORE_FIXTURE_AGENT_PASSWORD,
    displayName: 'Atlas',
    avatarAssetPath: 'scripts/fixtures/appstore/avatars/atlas.png',
  },
];

const summaryContent = ({ emoji, summary, messageCount }) => {
  const contextualSummary = `${emoji} ${summary}`;

  return noticeMessage(contextualSummary, {
    'io.mindroom.thread_summary': {
      version: 1,
      generated_at: '2026-07-04T17:15:00.000Z',
      message_count: messageCount,
      summary: contextualSummary,
    },
  });
};

const scheduledAtDaysFromNow = (now, days, hourUtc, minuteUtc) => {
  const scheduled = new Date(now);
  scheduled.setUTCDate(scheduled.getUTCDate() + days);
  scheduled.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return scheduled.toISOString();
};

const demoThread = (id, prompt, sender, body, emoji, summary, tags, tools = [], scheduledAt) => ({
  id,
  root: { sender: 'primary', body: prompt, content: textMessage(prompt) },
  replies: [
    {
      sender,
      content: textMessage(body, {
        ...buildAiRunMetadata({
          runId: `demo-${id}`,
          toolCount: tools.length,
          outputTokens: 180,
          modelConfig: sender === 'atlas' ? 'opus' : 'astra',
        }),
        ...(tools.length
          ? buildToolTraceMetadata(
              tools.map(([toolName, argsPreview, resultPreview]) => ({
                type: 'tool_call_completed',
                tool_name: toolName,
                args_preview: argsPreview,
                result_preview: resultPreview,
              }))
            )
          : {}),
      }),
    },
  ],
  summary: { sender, content: summaryContent({ emoji, summary, messageCount: 2 }) },
  tags,
  scheduledAt,
});

// Adapted from mindroom-ai/demo's fictional Rivera household scenes.
// Keep scene IDs stable for the existing release screenshot filenames.
export const buildAppStoreFixtureThreads = ({ now = new Date() } = {}) => [
  demoThread(
    'personal-workspace',
    "What's happening this week?",
    'atlas',
    '## Your week, together\n\n- **Lisbon:** three weekend plans under €900 for two.\n- **Dinner:** five vegetarian meals, all within 30 minutes.\n- **Home:** lights, locks, and heating handled.\n- **Reminders:** call Rosa at four.\n\nEverything stays in its own thread.',
    '🧭',
    'Your week: Lisbon plans, quick dinners, a cozy home, and one timely reminder.',
    ['this-week']
  ),
  demoThread(
    'mindroom-explained',
    "Pantry, plan dinners for next week. Leo's vegetarian now, and weeknights need to be within 30 minutes.",
    'pantry',
    'Noted for good: **Leo is vegetarian**, and weeknights stay within 30 minutes.\n\n## Dinner, sorted\n\n- **Mon:** Lemony chickpea orzo · 25 min\n- **Tue:** Black bean tacos with lime slaw · 20 min\n- **Wed:** Coconut red lentil dal · 30 min\n- **Thu:** Halloumi and peppers · 30 min\n- **Fri:** Pesto gnocchi with peas · 15 min\n\n## Groceries\n\nChickpeas, orzo, lemons, black beans, tortillas, cabbage, limes, lentils, coconut milk, halloumi, peppers, gnocchi, pesto, and peas.',
    '🥗',
    'Vegetarian weeknight dinners: five quick meals and one grocery list.',
    ['meal-plan', 'vegetarian']
  ),
  demoThread(
    'campground-monitor',
    "Hearth, we're heading out. Turn off the lights, lock the front door, and set the heat to 17 degrees.",
    'hearth',
    '## All set. Have a lovely evening!\n\n- **Lights:** off throughout the house.\n- **Front door:** locked and checked.\n- **Heating:** set to 17°C.\n\n🔧 `call_service` [1]\n🔧 `call_service` [2]\n🔧 `get_state` [3]',
    '🏡',
    'Heading out: lights off, front door locked, heating set to 17°C.',
    ['home', 'automation'],
    [
      ['call_service', 'light.turn_off · all lights', 'All lights are off.'],
      [
        'call_service',
        'lock.lock · front door; climate.set_temperature · 17°C',
        'Door locked; heating set to 17°C.',
      ],
      ['get_state', 'lock.front_door', 'locked'],
    ]
  ),
  demoThread(
    'car-search',
    'Atlas, plan a weekend in Lisbon for Leo and me. Under €900 for both of us.',
    'atlas',
    "You're both free that weekend. Three ways to do it under €900:\n\n## 🏛️ Old town · €842\nTAP flights + Casa do Bairro, Alfama. Two nights, river views.\n\n## 🌊 By the sea · €860\nKLM flights + Farol Bay, Cascais. A quiet stay by the sea.\n\n## 🌿 A long weekend · €795\nTransavia flights + Jardim Suites. More time for the city.\n\n**Which one should I plan around?**",
    '🇵🇹',
    'Lisbon weekend for two: old town, by the sea, or a long weekend.',
    ['lisbon', 'weekend']
  ),
  demoThread(
    'home-reminders',
    'Hearth, remind me tomorrow at four to call Rosa back.',
    'hearth',
    "⏰ Got it. I'll remind you tomorrow at **4:00 PM** to call Rosa back.\n\n## One less thing to remember\n\nThe reminder stays here in this thread, so the conversation is easy to pick up later.",
    '⏰',
    'Call Rosa at four: reminder scheduled in this thread.',
    ['reminders'],
    [],
    scheduledAtDaysFromNow(now, 1, 16, 0)
  ),
];

export const buildScheduledTaskContent = (threadRootId, executeAt) => ({
  status: 'pending',
  thread_id: threadRootId,
  new_thread: false,
  execute_at: executeAt,
});

export const buildCanonicalThreadTagStateKey = (threadRootId, tagName) =>
  JSON.stringify([threadRootId, tagName]);

export const buildThreadTagContent = (userId, setAt = '2026-07-04T17:20:00.000Z') => ({
  set_by: userId,
  set_at: setAt,
});
