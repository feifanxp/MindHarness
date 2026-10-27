import { useEffect } from 'react';
import type {
  ThreadOpenRuntime,
  ThreadRoute,
  ThreadSessionCommands,
} from './session/threadSessionTypes';

/** Install after route opening and before focus consumers, independently of snapshot updates. */
export const useThreadOpenLifecycleController = ({
  route: { roomId, threadId, eventId },
  commands,
  runtime,
}: {
  route: ThreadRoute;
  commands: ThreadSessionCommands;
  runtime: ThreadOpenRuntime;
}) => {
  useEffect(() => {
    if (!threadId) return undefined;
    return commands.startOpen(runtime);
  }, [commands, runtime, roomId, threadId, eventId]);

  const { render, viewport } = runtime;
  useEffect(() => {
    if (threadId) return;
    commands.leaveThread({ render, viewport });
  }, [commands, render, viewport, threadId]);
};
