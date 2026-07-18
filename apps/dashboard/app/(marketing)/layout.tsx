import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mkt">
      <header className="mnav">
        <div className="mnav-inner">
          <Link href="/" className="mnav-brand">
            <Image src="/images/tissue-lockup.svg" alt="Tissue" width={128} height={33} priority />
          </Link>
          <nav className="mnav-links">
            <Link href="/grade">📊 Grade</Link>
            <Link href="/analyst">💬 Ask</Link>
            <Link href="/overview" className="lp-btn lp-btn-primary" style={{ padding: "8px 16px" }}>
              Open desk
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mfooter">
        <div className="mfooter-inner">
          <span>Tissue. Live TxLINE input. Autonomous quote policy. Verifiable decisions.</span>
          <span>TxLINE prices the world. Tissue prices the game.</span>
        </div>
      </footer>
    </div>
  );
}
