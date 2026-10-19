import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { navigation } from '../lib/routes.js';

export default function AppLayout({ user, message, onSignOut, onDismiss }) {
  const location = useLocation();
  const items = navigation.filter((item) => !item.adminOnly || user.isAdmin);
  const pageTitle = items.find((item) => item.path === location.pathname.replace(/\/+$/, ''))?.label || 'Page not found';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div><strong>MAK Pharma</strong><span>Inventory Management</span></div>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace">
        {items.map(({ path, label, icon }) => <NavLink to={path} end key={path}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="nav-icon">{icon}</span>{label}
        </NavLink>)}
      </nav>
      <div className="sidebar-footer"><span className="status-dot" /> Inventory system online</div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand">MAK <span>Inventory</span></div>
        <div className="breadcrumb">Workspace <span>/</span> <strong>{pageTitle}</strong></div>
        <div className="topbar-account">
          <div className="company-chip">{user.displayName || user.username}</div>
          <button className="button secondary signout-button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <div className="content">
        {message && <div className={`notice ${message.kind}`} role="status">
          <span>{message.text}</span><button aria-label="Dismiss message" onClick={onDismiss}>×</button>
        </div>}
        <Outlet />
      </div>
    </main>
  </div>;
}
