import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/classNames';
import styles from './Snackbar.module.css';

export interface SnackbarProps {
  message: string;
  variant?: 'success' | 'warning' | 'error' | 'info';
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;
  onClose: () => void;
  isVisible: boolean;
}

export function Snackbar({
  message,
  variant = 'info',
  icon,
  action,
  duration = 4000,
  onClose,
  isVisible,
}: SnackbarProps) {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose, isVisible]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95, x: '-50%' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
          exit={{ opacity: 0, y: 20, scale: 0.95, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={cn(styles.snackbar, styles[variant])}
          role="alert"
          aria-live="assertive"
        >
          {icon && <span className={styles.icon}>{icon}</span>}
          <span className={styles.message}>{message}</span>
          {action && (
            <button className={styles.action} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
