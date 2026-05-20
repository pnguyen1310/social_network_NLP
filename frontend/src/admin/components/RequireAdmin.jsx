import { Navigate, Outlet } from 'react-router-dom';
import { getTokenPayload } from '../../user/api/auth'; // hàm decode token

export default function RequireAdmin() {
  const payload = getTokenPayload();
  if (!payload || payload.role !== 'ADMIN') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
