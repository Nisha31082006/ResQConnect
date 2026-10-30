import { useEffect, useRef } from 'react';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';

/** Subscribe to one or more Socket.IO events for the lifetime of a component. Handlers are always the latest closure. */
export function useSocketEvents(events: string[], handler: (event: string, payload: unknown) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  const { user } = useAuth();
  const key = events.join('|');
  useEffect(() => {
    // The socket is created right after login; poll briefly until it exists.
    let off: (() => void) | undefined;
    let tries = 0;
    const attach = () => {
      const s = getSocket();
      if (!s) {
        if (tries++ < 20) timer = setTimeout(attach, 250);
        return;
      }
      const fns = events.map((e) => {
        const fn = (p: unknown) => ref.current(e, p);
        s.on(e, fn);
        return [e, fn] as const;
      });
      off = () => fns.forEach(([e, fn]) => s.off(e, fn));
    };
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id]);
}
