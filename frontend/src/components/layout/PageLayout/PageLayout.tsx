import type { ReactNode } from 'react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import styles from './PageLayout.module.css';

export interface PageLayoutProps {
  children: ReactNode;
  showNav?: boolean;
  showFooter?: boolean;
}

export function PageLayout({
  children,
  showNav = true,
  showFooter = true,
}: PageLayoutProps) {
  return (
    <div className={styles.pageLayout}>
      {showNav && <Navbar />}
      <main className={styles.main}>{children}</main>
      {showFooter && <Footer />}
    </div>
  );
}
