import { useEffect, useCallback, useState, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  showClose?: boolean;
  children: ReactNode;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  showClose = true,
  children,
}: BottomSheetProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 250);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('no-scroll');

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('no-scroll');
    };
  }, [isOpen, handleClose]);

  if (!isOpen && !closing) return null;

  return (
    <>
      <div
        className={cn(styles.overlay, closing && styles.closing)}
        onClick={handleClose}
      />
      <div
        className={cn(styles.sheet, closing && styles.closing)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'sheet-title' : undefined}
      >
        <div className={styles.handle}>
          <div className={styles.handleBar} />
        </div>

        {(title || showClose) && (
          <div className={styles.header}>
            {title && (
              <h2 id="sheet-title" className={styles.title}>
                {title}
              </h2>
            )}
            {showClose && (
              <button
                className={styles.closeButton}
                onClick={handleClose}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        )}

        <div className={styles.content}>{children}</div>
      </div>
    </>
  );
}
