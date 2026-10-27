import { MatrixEvent } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { hasTerminalMindroomStreamMetadata, isMindroomAiRunStreaming } from './aiRun';
import { type AnnotationEntry, getActiveAnnotationsByKey } from '../../utils/reactionAnnotations';

/**
 * Stop-button reaction keys the MindRoom backend attaches to streaming
 * responses: 🛑 today, ⏹️/⏹ historically (the backend's own stale-stream
 * cleanup recognizes both families).
 */
export const STOP_REACTION_KEYS: ReadonlySet<string> = new Set(['🛑', '⏹️', '⏹']);

/**
 * The stop button is ephemeral streaming UI carried as a durable reaction.
 * The backend redacts it after the final edit, but a client that was closed
 * at stream completion can miss that redaction forever (gappy sync does not
 * redeliver it, and the pruned reaction drops out of later /relations
 * responses entirely). The message's own edit-converged content is the
 * authoritative stream state, so a stop chip on a terminally-finished
 * message is always stale — hide it instead of trusting reaction
 * convergence.
 */
export const isStaleStopReactionKey = (
  key: string,
  targetEvent: MatrixEvent | undefined
): boolean =>
  STOP_REACTION_KEYS.has(key) &&
  !!targetEvent &&
  hasTerminalMindroomStreamMetadata((targetEvent.getContent() as Record<string, unknown>) ?? {});

export const getRenderableAnnotationsByKey = (
  relations: Relations | undefined,
  targetEvent: MatrixEvent | undefined
): AnnotationEntry[] =>
  getActiveAnnotationsByKey(relations).filter(([key]) => !isStaleStopReactionKey(key, targetEvent));

/**
 * The stop button itself: the agent's 🛑 reaction on its reply while
 * that reply streams. Clicking it adds the viewer's stop reaction, which
 * stops the reply.
 */
export const isAgentStopButton = (
  key: string,
  events: readonly MatrixEvent[],
  targetEvent: MatrixEvent | undefined
): boolean =>
  key === '🛑' &&
  !!targetEvent &&
  isMindroomAiRunStreaming((targetEvent.getContent() as Record<string, unknown>) ?? {}) &&
  events.some((event) => event.getSender() === targetEvent.getSender());
