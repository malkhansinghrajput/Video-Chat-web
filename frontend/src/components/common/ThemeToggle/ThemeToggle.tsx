import { useAppStore } from '@/stores/appStore';
import { cn } from '@/utils/classNames';
import type { Theme } from '@/types/common.types';
import styles from './ThemeToggle.module.css';

const options: { value: Theme; icon: string; label: string }[] = [
  { value: 'light', icon: '☀️', label: 'Light theme' },
  { value: 'dark', icon: '🌙', label: 'Dark theme' },
  { value: 'system', icon: '💻', label: 'System theme' },
];

export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div className={styles.themeToggle} role="radiogroup" aria-label="Theme selection">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={cn(styles.option, theme === opt.value && styles.active)}
          onClick={() => setTheme(opt.value)}
          role="radio"
          aria-checked={theme === opt.value}
          aria-label={opt.label}
          title={opt.label}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
