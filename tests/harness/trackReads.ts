/**
 * Leaf-read tracking for the owner-coverage test (single-source plan 3.2).
 *
 * `trackReads(payload)` returns a deep proxy that records every property READ
 * by path (`presentation.lifecycle`, `evidenceLineItems.0.field`). What counts:
 *
 *   - a `get` on a property BELOW an owner key (the code looked inside the owner);
 *   - a `get` of the owner key itself when its value is not an object
 *     (a string/null/absent owner has nothing below it to look at).
 *
 * What does NOT count: `ownKeys`, `has`, enumeration (`Object.keys/entries/values`),
 * object spread (`{...x}`), `JSON.stringify`, and passing an owner object along.
 * Enumeration and spread are recognised by their trap sequence: they ask for
 * the property descriptor immediately before the `get`, a direct read does not.
 * `JSON.stringify` is neutralised by answering `toJSON` with the raw target.
 */

type Path = string;

const isTrackable = (v: unknown): v is object => {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export interface Tracker<T> {
  proxy: T;
  /** Every counted read path, e.g. `presentation.lifecycle`. */
  reads: Set<Path>;
}

export function trackReads<T extends object>(root: T, into: Set<Path> = new Set()): Tracker<T> {
  const wrappers = new WeakMap<object, Map<Path, object>>();

  const wrap = (target: object, path: Path): object => {
    let byPath = wrappers.get(target);
    if (!byPath) wrappers.set(target, (byPath = new Map()));
    const hit = byPath.get(path);
    if (hit) return hit;
    // A descriptor lookup immediately followed by a get of the same key is enumeration/spread.
    let descriptorFor: string | symbol | null = null;
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(t, key) {
        descriptorFor = key;
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
      get(t, key, receiver) {
        if (typeof key === "symbol") return Reflect.get(t, key, receiver);
        if (key === "toJSON") return () => t;
        if (key === "constructor") return Reflect.get(t, key, receiver);
        const enumerating = descriptorFor === key;
        descriptorFor = null;
        const value = Reflect.get(t, key, receiver);
        const child = path === "" ? key : `${path}.${key}`;
        if (!enumerating) into.add(child);
        return isTrackable(value) ? wrap(value, child) : value;
      },
    });
    byPath.set(path, proxy);
    return proxy;
  };

  return { proxy: wrap(root, "") as T, reads: into };
}

/**
 * Is `owner` (a dotted payload path) read? `valueAt` is the owner's value in the
 * payload the reads were recorded against.
 */
export function ownerIsRead(owner: string, reads: ReadonlySet<Path>, valueAt: unknown): boolean {
  const below = `${owner}.`;
  for (const r of reads) if (r.startsWith(below)) return true;
  // A non-object owner (string, null, absent) has no leaves: reading the key is the read.
  return !isTrackable(valueAt) && reads.has(owner);
}

export function valueAtPath(payload: unknown, dotted: string): unknown {
  let cur: unknown = payload;
  for (const seg of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
