import { describe, expect, it } from 'vitest';
import {
  appFile,
  appRelativePath,
  isReExportOnlyModule,
  mindroomFile,
  moduleSpecifiers,
  resolvedDependencies,
  walkProductionSources,
} from './architectureTestUtils';

const COMPATIBILITY_SEAMS = [
  {
    file: 'features/room/RoomTimeline.tsx',
    target: '../../mindroom/threads/MindroomRoomTimeline',
  },
  { file: 'features/room/RoomView.tsx', target: '../../mindroom/threads/MindroomRoomView' },
  {
    file: 'features/room/RoomViewHeader.tsx',
    target: '../../mindroom/threads/MindroomRoomViewHeader',
  },
  { file: 'features/room/Room.tsx', target: '../../mindroom/threads/MindroomRoom' },
  {
    file: 'features/room/RoomInput.tsx',
    target: '../../mindroom/room-input/MindroomRoomInput',
  },
  {
    file: 'features/room/room-pin-menu/RoomPinMenu.tsx',
    target: '../../../mindroom/messages/MindroomRoomPinMenu',
  },
  {
    file: 'features/room/message/Message.tsx',
    target: '../../../mindroom/messages/MindroomMessage',
  },
] as const;

describe('generic room compatibility seams', () => {
  it.each(COMPATIBILITY_SEAMS)('$file is a re-export-only module', ({ file, target }) => {
    const path = appFile(file);

    expect(isReExportOnlyModule(path)).toBe(true);
    expect(moduleSpecifiers(path)).toEqual([target]);
  });

  it('keeps fork-owned production modules off the compatibility seams', () => {
    const seamPaths = new Set(COMPATIBILITY_SEAMS.map(({ file }) => appFile(file)));
    const offenders = walkProductionSources(mindroomFile(''))
      .filter((file) => {
        const dependencies = resolvedDependencies(file);
        return [...seamPaths].some((seam) => dependencies.has(seam));
      })
      .map(appRelativePath);

    expect(offenders).toEqual([]);
  });

  it('routes the application shell directly to the fork-owned room module', () => {
    const routerDependencies = resolvedDependencies(appFile('pages/Router.tsx'));

    expect(routerDependencies).toContain(mindroomFile('threads/MindroomRoom.tsx'));
    expect(routerDependencies).not.toContain(appFile('features/room/Room.tsx'));
  });

  it('composes the fork-owned room shell without looping through generic seams', () => {
    const roomDependencies = resolvedDependencies(mindroomFile('threads/MindroomRoom.tsx'));
    const viewDependencies = resolvedDependencies(mindroomFile('threads/MindroomRoomView.tsx'));

    expect(roomDependencies).toContain(mindroomFile('threads/MindroomRoomView.tsx'));
    expect(roomDependencies).toContain(mindroomFile('threads/MindroomRoomViewHeader.tsx'));
    expect(viewDependencies).toContain(mindroomFile('threads/MindroomRoomTimeline.tsx'));
    expect(viewDependencies).toContain(mindroomFile('room-input/MindroomRoomInput.tsx'));
  });
});
