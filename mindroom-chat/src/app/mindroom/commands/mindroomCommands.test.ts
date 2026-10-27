import { describe, expect, it } from 'vitest';
import { MINDROOM_COMMANDS } from './mindroomCommands';

describe('MINDROOM_COMMANDS', () => {
  it('mirrors the MindRoom bot command set', () => {
    const names = MINDROOM_COMMANDS.map((c) => c.name);
    expect(names).toEqual([
      'help',
      'reload-plugins',
      'schedule',
      'list_schedules',
      'cancel_schedule',
      'edit_schedule',
      'config',
      'desktop',
      'model',
      'room_model',
      'thread_mode',
      'encrypt',
      'e2ee',
      'hi',
    ]);
  });

  it('prefixes every syntax with the command name', () => {
    MINDROOM_COMMANDS.forEach((command) => {
      expect(command.syntax.startsWith(`!${command.name}`)).toBe(true);
    });
  });
});
