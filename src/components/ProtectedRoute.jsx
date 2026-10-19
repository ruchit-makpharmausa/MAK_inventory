import { Navigate, Outlet, useLocation } from 'react-router-dom';

export default function ProtectedRoute({ user }) {
  const location = useLocation();
  if (user) return <Outlet />;
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
}
