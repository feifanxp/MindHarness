import type { CustomHtmlSanitizerPolicy } from '../../utils/sanitize';

export const MINDROOM_HTML_BLOCK_TAGS = [
  'think',
  'debug',
  'system',
  'plan',
  'analysis',
  'research',
];

export const mindroomCustomHtmlSanitizerPolicy: CustomHtmlSanitizerPolicy = {
  allowedTags: MINDROOM_HTML_BLOCK_TAGS,
  allowedAttributes: {
    span: [
      'data-mx-maths',
      'data-mindroom-paste-marker',
      'data-mindroom-paste-id',
      'data-mindroom-paste-chars',
      'data-mindroom-paste-file',
    ],
    div: ['data-mx-maths'],
  },
};
