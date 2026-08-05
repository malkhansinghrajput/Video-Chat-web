import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/utils/classNames';
import styles from './Button.module.css';

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "className" | "size"> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  glow?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  glow = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        glow && styles.glow,
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      {children}
      {iconRight && <span className={styles.icon}>{iconRight}</span>}
      {loading && (
        <span className={styles.spinner}>
          <LoadingDots />
        </span>
      )}
    </motion.button>
  );
}

function LoadingDots() {
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" fill="currentColor">
      <circle cx="4" cy="4" r="3" opacity="0.4">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite" begin="0s" />
      </circle>
      <circle cx="12" cy="4" r="3" opacity="0.4">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite" begin="0.2s" />
      </circle>
      <circle cx="20" cy="4" r="3" opacity="0.4">
        <animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite" begin="0.4s" />
      </circle>
    </svg>
  );
}
