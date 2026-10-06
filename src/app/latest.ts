/**
 * Wraps async loads so only the most recent one settles; an earlier, slower answer is dropped
 * (its promise never settles), so it can't overwrite what the user picked since.
 */
export function latestOnly() {
  let n = 0;
  return <T,>(p: Promise<T>): Promise<T> => {
    const id = ++n;
    const never = new Promise<T>(() => {});
    return p.then(
      (v) => (id === n ? v : never),
      (e) => (id === n ? Promise.reject(e) : never),
    );
  };
}
