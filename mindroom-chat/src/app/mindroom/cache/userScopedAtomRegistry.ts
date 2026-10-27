import { getSafeLocalStorage, removeStorageItemSafe } from '../../utils/safeLocalStorage';

export type UserScopedAtomRegistry<TAtom> = {
  getOrCreate: (userId: string) => TAtom;
  registerActive: (userId: string, atom: TAtom) => () => void;
  resolveActiveOrCreate: (userId: string | undefined) => TAtom | undefined;
  clear: (userId: string) => void;
};

type UserScopedAtomRegistryOptions<TAtom> = {
  create: (userId: string) => TAtom;
  getStorageKey: (userId: string) => string;
  cacheEmptyUserId?: boolean;
};

/**
 * Owns the repeated lifecycle shared by per-account UI atoms: stable atom
 * identity, an optional provider-registered active atom for imperative writes,
 * and account cleanup that forgets both memory and localStorage state.
 */
export const createUserScopedAtomRegistry = <TAtom>({
  create,
  getStorageKey,
  cacheEmptyUserId = true,
}: UserScopedAtomRegistryOptions<TAtom>): UserScopedAtomRegistry<TAtom> => {
  const atoms = new Map<string, TAtom>();
  let active: { userId: string; atom: TAtom } | undefined;

  const getOrCreate = (userId: string): TAtom => {
    if (!userId && !cacheEmptyUserId) return create(userId);

    const existing = atoms.get(userId);
    if (existing) return existing;

    const next = create(userId);
    atoms.set(userId, next);
    return next;
  };

  const registerActive = (userId: string, atom: TAtom): (() => void) => {
    const registration = { userId, atom };
    active = registration;
    return () => {
      if (active === registration) active = undefined;
    };
  };

  const resolveActiveOrCreate = (userId: string | undefined): TAtom | undefined => {
    // A mounted provider remains authoritative when no session can be read
    // (tests and storage-restricted startup). Once a session ID is available,
    // however, never route it through a registration owned by another user.
    if (!userId) return active?.atom;
    return active?.userId === userId ? active.atom : getOrCreate(userId);
  };

  const clear = (userId: string): void => {
    const atom = atoms.get(userId);
    const storageKey = getStorageKey(userId);
    removeStorageItemSafe(getSafeLocalStorage(), storageKey);
    if (active?.userId === userId && active.atom === atom) active = undefined;
    atoms.delete(userId);
  };

  return { getOrCreate, registerActive, resolveActiveOrCreate, clear };
};
