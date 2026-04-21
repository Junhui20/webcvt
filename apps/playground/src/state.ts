/**
 * Minimal reactive store — no external dependencies.
 * Subscribers are called synchronously on each update.
 */
export interface Store<T> {
  /** Read current state. */
  readonly get: () => T;
  /** Replace entire state and notify subscribers. */
  readonly set: (next: T) => void;
  /** Subscribe to state changes. Returns unsubscribe function. */
  readonly subscribe: (listener: (state: T) => void) => () => void;
  /** Apply a partial patch to the current state. */
  readonly patch: (partial: Partial<T>) => void;
}

export function createStore<T>(initial: T): Store<T> {
  let current: T = initial;
  const listeners = new Set<(state: T) => void>();

  const get = (): T => current;

  const set = (next: T): void => {
    current = next;
    for (const listener of listeners) {
      listener(current);
    }
  };

  const subscribe = (listener: (state: T) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const patch = (partial: Partial<T>): void => {
    set({ ...current, ...partial });
  };

  return { get, set, subscribe, patch };
}
