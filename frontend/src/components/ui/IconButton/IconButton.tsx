import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'glass' | 'ghost' | 'filled' | 'danger';
  active?: boolean;
  muted?: boolean;
  tooltip?: string;
  badge?: number;
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
  ...props
}: IconButtonProps) {
  const button = (
    <button
      className={cn(
        styles.iconButton,
        styles[size],
        styles[variant],
        active && styles.active,
        muted && styles.muted,
        className
      )}
      aria-label={tooltip}
      {...props}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className={styles.badgeWrapper}>
          <Badge count={badge} />
        </span>
      )}
    </button>
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
