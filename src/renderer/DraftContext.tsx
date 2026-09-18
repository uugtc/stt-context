import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

interface DraftActions {
  flush: () => Promise<void>;
  register: (save: () => Promise<void>) => () => void;
}
const DraftContext = createContext<DraftActions | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const pending = useRef<(() => Promise<void>) | null>(null);
  const actions = useMemo<DraftActions>(
    () => ({
      flush: async () => {
        await pending.current?.();
      },
      register: (save) => {
        pending.current = save;
        return () => {
          if (pending.current === save) pending.current = null;
        };
      },
    }),
    [],
  );
  return <DraftContext.Provider value={actions}>{children}</DraftContext.Provider>;
}
export function useDraft(): DraftActions {
  const actions = useContext(DraftContext);
  if (!actions) throw new Error('DraftProvider is required');
  return actions;
}
