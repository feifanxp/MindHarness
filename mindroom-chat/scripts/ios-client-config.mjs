/** Explicit bundled iOS deployment settings; ordinary web builds keep their config. */
export const iosClientConfig = (
  source,
  settings,
  computerApiUrl = settings.mindroom.computers.apiUrl
) => {
  const config = JSON.parse(source);
  return JSON.stringify(
    {
      ...config,
      mindroom: {
        ...config.mindroom,
        canvas: settings.mindroom.canvas,
        computers: { apiUrl: computerApiUrl },
      },
    },
    null,
    2
  );
};
