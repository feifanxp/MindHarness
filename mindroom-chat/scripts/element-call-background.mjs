export const transparentCallBackground =
  '<style>html,body{background:transparent!important}</style>';

export const injectElementCallTransparentBackground = (html) => {
  if (!html.includes('<head>')) {
    throw new Error('Element Call index is missing its <head> element');
  }
  return html.replace('<head>', `<head>${transparentCallBackground}`);
};

export const assertElementCallTransparentBackground = (html) => {
  if (!html.includes(transparentCallBackground)) {
    throw new Error('Built Element Call index is missing its transparent background override');
  }
};
