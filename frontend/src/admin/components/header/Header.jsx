import React from 'react';
import { LogOut, User } from 'lucide-react';
import '../header/Header.css';

export default function Header({ userName, onLogout }) {
  const handleLogoutClick = () => {
    onLogout?.();
  };

  return (
    <header className="admin-header">
      <div className="header-content">
        <h2 className="page-title">Dashboard Quản trị</h2>

        <div className="header-actions">
          <div className="user-info">
            <div className="user-avatar">
              <User size={20} />
            </div>
            <span className="user-name">{userName || 'Admin'}</span>
          </div>

          <button className="btn-logout" onClick={handleLogoutClick} title="Đăng xuất">
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
