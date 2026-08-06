import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/utils/classNames';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "className" | "size"> {
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'glass' | 'ghost' | 'filled' | 'danger';
  active?: boolean;
  muted?: boolean;
  tooltip?: string;
  badge?: number;
  className?: string;
}

export function IconButton({
  icon,
  size = 'md',
  variant = 'glass',
  active = false,
  muted = false,
  tooltip,
  badge,
  className,
  disabled,
  ...props
}: IconButtonProps) {
  const button = (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.05 }}
      whileTap={{ scale: disabled ? 1 : 0.9 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        styles.iconButton,
        styles[size],
        styles[variant],
        active && styles.active,
        muted && styles.muted,
        className
      )}
      aria-label={tooltip}
      disabled={disabled}
      {...props}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className={styles.badgeWrapper}>
          <Badge count={badge} />
        </span>
      )}
    </motion.button>
  );

  if (tooltip) {
    return (
      <div className={styles.tooltipWrapper}>
        {button}
        <span className={styles.tooltip} role="tooltip">
          {tooltip}
        </span>
      </div>
    );
  }

  return button;
}

/* Inline Badge sub-component */
function Badge({ count }: { count: number }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '18px',
        height: '18px',
        padding: '0 5px',
        borderRadius: '9999px',
        background: 'var(--danger)',
        color: 'white',
        fontSize: '10px',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
