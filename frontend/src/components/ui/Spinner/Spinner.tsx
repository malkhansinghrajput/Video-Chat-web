import { cn } from '@/utils/classNames';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}

export function Spinner({ size = 'md', color, className }: SpinnerProps) {
  return (
    <div
      className={cn(styles.spinner, styles[size], className)}
      style={color ? { borderTopColor: color } : undefined}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
