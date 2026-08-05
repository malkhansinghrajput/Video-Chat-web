import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
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
  const controls = useAnimation();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('no-scroll');
    };
  }, [isOpen, onClose]);

  const handleDragEnd = (e: any, info: any) => {
    // Close if dragged down far enough or fast enough
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    } else {
      controls.start({ y: 0 }); // Snap back
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={styles.overlay}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={controls}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.05}
            onDragEnd={handleDragEnd}
            className={styles.sheet}
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
                    onClick={onClose}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            <div className={styles.content}>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
