import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { cn } from '@/utils/classNames';
import styles from './Navbar.module.css';

const NAV_LINKS = [
  { path: '/about', label: 'About' },
  { path: '/guidelines', label: 'Guidelines' },
  { path: '/privacy', label: 'Privacy' },
];

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  /* Close mobile menu on route change */
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <nav className={cn(styles.navbar, scrolled && styles.scrolled)}>
        <div className={styles.inner}>
          <Link to="/" className={styles.logo}>
            <span className={styles.logoIcon}>▶</span>
            <span>VideoChatWeb</span>
          </Link>

          <div className={styles.navLinks}>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  styles.navLink,
                  location.pathname === link.path && styles.active
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className={styles.actions}>
            <ThemeToggle />
            <button
              className={styles.hamburger}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      <div className={cn(styles.mobileMenu, menuOpen && styles.open)}>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            className={styles.mobileNavLink}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}
