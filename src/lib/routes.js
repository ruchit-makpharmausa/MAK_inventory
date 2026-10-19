export const navigation = [
  { path: '/dashboard', label: 'Dashboard', icon: '◫' },
  { path: '/products', label: 'Product Master', icon: '▤' },
  { path: '/receiving', label: 'Receiving', icon: '↓' },
  { path: '/usage', label: 'Usage', icon: '↑' },
  { path: '/inv_history', label: 'Inventory History', icon: '◷' },
  { path: '/admin', label: 'Admin Panel', icon: '⚙', adminOnly: true },
];

export function loginDestination(from, isAdmin = false) {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/dashboard';
  try {
    const base = 'http://inventory.local';
    const url = new URL(from, base);
    if (url.origin !== base) return '/dashboard';
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const path = pathname === '/history' ? '/inv_history' : pathname;
    const route = navigation.find((item) => item.path === path);
    if (!route || route.adminOnly && !isAdmin) return '/dashboard';
    return `${path}${url.search}${url.hash}`;
  } catch {
    return '/dashboard';
  }
}
