import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

// Composant 12 : toast avec annulation. 6 secondes, action « Annuler »
// systématique sur toute décision réversible. Remplace alert()/confirm().

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  second?: ToastAction;
}

interface ToastApi {
  toast: (message: string, action?: ToastAction, second?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, action?: ToastAction, second?: ToastAction) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-2), { id, message, action, second }]);
    window.setTimeout(() => dismiss(id), 6000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            {t.action && (
              <button onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            {t.second && (
              <button onClick={() => { t.second!.onClick(); dismiss(t.id); }}>
                {t.second.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
