import React, { useEffect, useRef } from 'react';
import { Users, Bell, LogOut } from 'lucide-react';
import './topbar.css';

export default function Topbar({
  authed = false,
  userName = '',
  onNav = {},
  onLogout,
  notifications = [],
  showDropdown = false,
  onToggleDropdown,
  onMarkAllRead,
  onMarkOneRead,
  friendRequests = [],
  showFriendDropdown = false,
  onToggleFriendDropdown,
  onAcceptFriend,
  onDeclineFriend,
  me = null,
}) {
  if (!authed) {
    return null;
  }

  const notifCount = notifications?.length || 0;
  const reqCount = friendRequests?.length || 0;

  const nameOf = (u) => u?.display_name || u?.name || 'Người dùng';
  const reqUserOf = (r) =>
    r?.from_user || r?.from || r?.sender || r?.user || r?.requester || null;

  const friendRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      const clickedInFriend = friendRef.current?.contains(e.target);
      const clickedInNotif = notifRef.current?.contains(e.target);

      if (showFriendDropdown && !clickedInFriend && onToggleFriendDropdown) {
        onToggleFriendDropdown();
      }
      if (showDropdown && !clickedInNotif && onToggleDropdown) {
        onToggleDropdown();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showDropdown, showFriendDropdown, onToggleDropdown, onToggleFriendDropdown]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showFriendDropdown && onToggleFriendDropdown) onToggleFriendDropdown();
      if (showDropdown && onToggleDropdown) onToggleDropdown();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDropdown, showFriendDropdown, onToggleDropdown, onToggleFriendDropdown]);

  const handleToggleFriend = () => {
    if (showDropdown && onToggleDropdown) onToggleDropdown();
    onToggleFriendDropdown?.();
  };

  const handleToggleNotif = () => {
    if (showFriendDropdown && onToggleFriendDropdown) onToggleFriendDropdown();
    onToggleDropdown?.();
  };

  const API_BASE =
    import.meta.env.VITE_API_BASE ||
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:8000';
  const avatarUrl = me?.avatar_url ? `${API_BASE}${me.avatar_url}` : null;

  return (
    <header className="topbar">
      <div className="topbar-content">
        {/* LEFT - Logo & Nav */}
        <div className="topbar-left">
          <button className="topbar-brand" onClick={onNav?.feed}>
            <span>SocialApp</span>
          </button>
          <nav className="topbar-nav">
            <button className="nav-item" onClick={onNav?.feed} title="Trang chủ">
              Trang chủ
            </button>
            <button className="nav-item" onClick={onNav?.search} title="Tìm kiếm">
              Tìm kiếm
            </button>
            <button className="nav-item" onClick={onNav?.profile} title="Trang cá nhân">
              Cá nhân
            </button>
          </nav>
        </div>

        {/* RIGHT - Icons & Dropdowns */}
        <div className="topbar-right">
          {/* Friend Requests */}
          <div className="topbar-icon-wrap" ref={friendRef}>
            <button
              className={`topbar-icon-btn ${showFriendDropdown ? 'active' : ''}`}
              onClick={handleToggleFriend}
              title="Lời mời kết bạn"
            >
              <Users className="icon-topbar" size={20} />
              <span>Kết bạn</span>
              {reqCount > 0 && <span className="badge">{reqCount}</span>}
            </button>

            {showFriendDropdown && (
              <div className="topbar-dropdown">
                <div className="dropdown-header">
                  <h3>Lời mời kết bạn ({reqCount})</h3>
                </div>
                <div className="dropdown-body">
                  {reqCount === 0 ? (
                    <div className="dropdown-empty">Không có lời mời nào</div>
                  ) : (
                    <div className="dropdown-list">
                      {friendRequests.slice(0, 5).map((r) => {
                        const user = reqUserOf(r);
                        const userAvatar = user?.avatar_url ? `${API_BASE}${user.avatar_url}` : null;
                        return (
                          <div key={r.id} className="dropdown-item">
                            <div className="item-avatar">
                              {userAvatar ? (
                                <img src={userAvatar} alt={nameOf(user)} />
                              ) : (
                                <div className="avatar-placeholder">
                                  {(nameOf(user) || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="item-info">
                              <span className="item-name">{nameOf(user)}</span>
                            </div>
                            <div className="item-actions">
                              <button
                                className="btn-sm accept"
                                onClick={() => onAcceptFriend?.(r.id)}
                              >
                                Chấp nhận
                              </button>
                              <button
                                className="btn-sm decline"
                                onClick={() => onDeclineFriend?.(r.id)}
                              >
                                Từ chối
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {reqCount > 5 && (
                        <div className="dropdown-more">+{reqCount - 5} thêm</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notifications */}
          <div className="topbar-icon-wrap" ref={notifRef}>
            <button
              className={`topbar-icon-btn ${showDropdown ? 'active' : ''}`}
              onClick={handleToggleNotif}
              title="Thông báo"
            >
              <Bell className="icon-topbar" size={20} />
              <span>Thông báo</span>
              {notifCount > 0 && <span className="badge">{notifCount}</span>}
            </button>

            {showDropdown && (
              <div className="topbar-dropdown">
                <div className="dropdown-header">
                  <h3>Thông báo ({notifCount})</h3>
                  {notifCount > 0 && (
                    <button className="dropdown-action" onClick={onMarkAllRead}>
                      Đánh dấu đã đọc
                    </button>
                  )}
                </div>
                <div className="dropdown-body">
                  {notifCount === 0 ? (
                    <div className="dropdown-empty">Không có thông báo nào</div>
                  ) : (
                    <div className="dropdown-list">
                      {notifications.slice(0, 5).map((n) => {
                        const msgText = n.message || n.content || n.text || '(Thông báo không có nội dung)';
                        return (
                          <button
                            key={n.id}
                            className={`dropdown-item ${n.is_read ? 'read' : 'unread'}`}
                            onClick={() => onMarkOneRead?.(n.id)}
                          >
                            <div className="item-info">
                              <span className="item-text">{msgText}</span>
                              <span className="item-time">
                                {new Date(n.created_at).toLocaleString()}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      {notifCount > 5 && (
                        <div className="dropdown-more">+{notifCount - 5} thêm</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile */}
          <div className="topbar-user">
            <button className="user-avatar" onClick={onNav?.profile}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={userName} />
              ) : (
                <span>{(userName || 'U').charAt(0).toUpperCase()}</span>
              )}
            </button>
            <span className="user-name">{userName}</span>
          </div>

          {/* Logout */}
          <button className="topbar-icon-btn topbar-logout" onClick={onLogout} title="Đăng xuất">
            <LogOut className="icon-topbar" size={20} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </div>
    </header>
  );
}
