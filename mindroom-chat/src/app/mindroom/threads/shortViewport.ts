// A phone held sideways is too short for stacked room chrome, so the header,
// thread banner and footer compact. Coarse pointers keep short desktop windows
// out, and landscape keeps most portrait keyboards from toggling the layout.
export const shortViewport =
  '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
