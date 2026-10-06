import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';

const ConfirmContext = createContext(null);

// Themed, accessible replacement for window.confirm(). Usage:
//
//   const confirmAction = useConfirm();
//   if (!(await confirmAction({ title: 'Delete label?', message: '…', confirmLabel: 'Delete', danger: true }))) return;
//
// Resolves true on confirm, false on cancel/Esc/backdrop click.
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const confirmAction = useCallback((options) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setRequest(options);
    });
  }, []);

  const settle = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
  }, []);

  const cancel = useCallback(() => settle(false), [settle]);

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      <Modal
        open={!!request}
        onClose={cancel}
        title={request?.title || 'Are you sure?'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={cancel}>
              {request?.cancelLabel || 'Cancel'}
            </Button>
            <Button variant={request?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {request?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--ds-text-secondary)', lineHeight: 'var(--ds-leading-normal)' }}>
          {request?.message}
        </p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
