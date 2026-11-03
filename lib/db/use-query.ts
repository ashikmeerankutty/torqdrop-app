import { useCallback, useEffect, useRef, useState } from "react";

import { onTableChange } from "./index";

type Table = Parameters<typeof onTableChange>[0];

/** Run an async database read, and again whenever one of `tables` changes. */
export function useDbQuery<T>(fn: () => Promise<T>, deps: unknown[], tables: Table[]): { data: T | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const n = ++seq.current;
    fnRef
      .current()
      .then((d) => {
        if (n === seq.current) setData(d);
      })
      .catch((e) => console.warn("db query failed", e))
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
    const offs = tables.map((t) => onTableChange(t, reload));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, tables.join(",")]);

  return { data, loading, reload };
}
