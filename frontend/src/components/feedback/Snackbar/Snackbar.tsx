import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import styles from './Snackbar.module.css';

export interface SnackbarProps {
  message: string;
  variant?: 'success' | 'warning' | 'error' | 'info';
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;
  onClose: () => void;
}

export function Snackbar({
  message,
  variant = 'info',
  icon,
  action,
  duration = 4000,
  onClose,
}: SnackbarProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onClose, 200);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      className={cn(styles.snackbar, styles[variant], exiting && styles.exiting)}
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
    </div>
  );
}
