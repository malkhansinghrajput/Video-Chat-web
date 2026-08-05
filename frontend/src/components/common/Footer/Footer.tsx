import { Link } from 'react-router-dom';
import styles from './Footer.module.css';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.brand}>▶ VideoChatWeb</span>

        <nav className={styles.links} aria-label="Footer navigation">
          <Link to="/about" className={styles.link}>About</Link>
          <Link to="/privacy" className={styles.link}>Privacy</Link>
          <Link to="/terms" className={styles.link}>Terms</Link>
          <Link to="/guidelines" className={styles.link}>Guidelines</Link>
        </nav>

        <p className={styles.copyright}>
          © {year} VideoChatWeb. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
