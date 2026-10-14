import Link from "next/link";
import type { ReactNode } from "react";

export default function WorkspaceShell({ children, current = "Portfolio" }: { children: ReactNode; current?: string }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark">S</span><span><strong>SAMANEXUS</strong><small>Compliance workspace</small></span></Link>
      <p className="nav-label">Workspace</p>
      <nav aria-label="Main navigation">
        <Link className={`nav-item ${current === "Portfolio" ? "active" : ""}`} aria-current={current === "Portfolio" ? "page" : undefined} href="/"><span aria-hidden="true">▦</span> Client portfolio</Link>
        {!["Client workspace", "Assessment"].includes(current) && <Link className={`nav-item ${current === "New client" ? "active" : ""}`} aria-current={current === "New client" ? "page" : undefined} href="/onboarding"><span aria-hidden="true">+</span> Add client</Link>}
      </nav>
      <div className="sidebar-note"><span className="nav-label">Phase 1</span><p>A clear starting point for your clients’ Cyber Essentials journey.</p></div>
      <Link href="/sign-in" className="nav-item account-link">Account &amp; security <span aria-hidden="true">↗</span></Link>
    </aside>
    <div className="main-content"><header className="topbar"><span>Workspace <span className="breadcrumb-divider">/</span> <strong>{current}</strong></span><span className="workspace-badge">Samanexus GRC</span></header>
      <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
