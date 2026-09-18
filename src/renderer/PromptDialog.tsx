import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Ask = (message: string, initial?: string) => Promise<string | null>;
const PromptContext = createContext<Ask | null>(null);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const resolve = useRef<((value: string | null) => void) | null>(null);
  const finish = (value: string | null) => {
    resolve.current?.(value);
    resolve.current = null;
    setMessage(null);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      resolve.current?.(null);
    };
  }, []);
  const ask: Ask = (message, initial = '') => {
    resolve.current?.(null);
    setMessage(message);
    setValue(initial);
    return new Promise((result) => {
      resolve.current = result;
    });
  };
  return (
    <PromptContext.Provider value={ask}>
      {children}
      {message !== null && (
        <div className="modal-backdrop" onClick={() => finish(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="prompt-title">{message}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finish(value);
              }}
            >
              <input
                aria-label={message}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={200}
              />
              <div className="modal-footer">
                <button className="secondary" type="button" onClick={() => finish(null)}>
                  キャンセル
                </button>
                <button className="primary" type="submit">
                  確定
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </PromptContext.Provider>
  );
}
export function usePrompt(): Ask {
  const ask = useContext(PromptContext);
  if (!ask) throw new Error('PromptProvider is required');
  return ask;
}
