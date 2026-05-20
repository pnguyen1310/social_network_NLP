import React, { useState, useEffect } from 'react';
import Login from './user/pages/Login.jsx';
import Register from './user/pages/Register.jsx';
import Feed from './user/pages/Feed.jsx';
import Profile from './user/pages/Profile.jsx';
import SearchUser from './user/pages/SearchUser.jsx';
import Topbar from './user/components/Topbar.jsx';
import ChatButton from './user/components/ChatButton.jsx';
import AdminDashboard from './admin/layouts/AdminDashboard.jsx';
import { useToast } from './components/Toast.jsx';
import http from './user/api/http';
import './App.css';

function safeGetJSON(key, fallback = null) {
  const raw = localStorage.getItem(key);
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normalizeMePayload(payload) {
  if (!payload) return null;
  if (payload.user && (payload.user.id != null || payload.user.email)) {
    return payload.user;
  }
  return payload;
}

// Ưu tiên VITE_API_BASE (chuẩn), fallback VITE_API_BASE_URL
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000';

const WS_BASE_FROM_PAGE = (() => {
  const { protocol, host } = window.location;
  const wsProto = protocol === 'https:' ? 'wss' : 'ws';
  // thay cổng bằng 8000 để khớp backend local
  return `${wsProto}://${host.replace(/:\d+$/, ':8000')}`;
})();
const WS_BASE = import.meta.env.VITE_WS_BASE_URL || WS_BASE_FROM_PAGE;
const WS_DISABLED = String(import.meta.env.VITE_DISABLE_WS || '') === '1';

export default function App() {
  // Toast notifications
  const toast = useToast();

  // Cập nhật thông tin token và me từ localStorage khi ứng dụng được tải lại
  const initialToken = localStorage.getItem('token') || '';
  const [token, setToken] = useState(initialToken);
  const [me, setMe] = useState(safeGetJSON('me', null));

  // ---- mini router theo pathname ----
  const [route, setRoute] = useState(window.location.pathname || '/');
  const goto = (path) => {
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path);
    }
    setRoute(path);
  };
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // UI phần user cũ dùng page state
  const [page, setPage] = useState(initialToken ? 'feed' : 'login');

  // Control body overflow khi ở login/register để ẩn thanh scroll
  useEffect(() => {
    if (page === 'login' || page === 'register') {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [page]);

  // dropdown states
  const [notifications, setNotifications] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [friendRequests, setFriendRequests] = useState([]);
  const [showFriendDropdown, setShowFriendDropdown] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;

    const syncMe = async () => {
      try {
        const res = await http.get('/auth/me');
        const freshMe = normalizeMePayload(res.data);
        if (!active || !freshMe) return;
        setMe(freshMe);
        localStorage.setItem('me', JSON.stringify(freshMe));
      } catch (e) {
        console.warn('Sync /auth/me failed:', e);
      }
    };

    syncMe();
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const onMeUpdated = (e) => {
      const updated = normalizeMePayload(e?.detail) || safeGetJSON('me', null);
      if (updated) setMe(updated);
    };

    window.addEventListener('me:updated', onMeUpdated);
    return () => window.removeEventListener('me:updated', onMeUpdated);
  }, []);

  const logout = () => {
    if (!window.confirm('Bạn có chắc muốn đăng xuất?')) return;
    
    localStorage.clear();
    setToken('');
    setMe(null);
    setPage('login');
    setNotifications([]);
    setFriendRequests([]);
    setShowDropdown(false);
    setShowFriendDropdown(false);
    goto('/');
  };

  useEffect(() => {
    if (!token || !me?.is_admin) return;
    if (route !== '/admin') goto('/admin');
  }, [token, me?.is_admin, route]);

  // 👉 luôn về profile của CHÍNH MÌNH
  const goMyProfile = () => {
    if (me?.id) localStorage.setItem('viewUserId', String(me.id));
    else localStorage.removeItem('viewUserId');
    setPage('profile');
    goto('/'); // hiển thị ở route '/'
  };

  // --------- notifications ----------
  useEffect(() => {
    if (!token || !me?.id || me?.is_admin) return;
    fetch(`${API_BASE}/notifications?unread_only=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(d => setNotifications(Array.isArray(d.items) ? d.items : []))
      .catch(e => console.warn('Load notifications failed:', e));
  }, [token, me?.id]);

  // --------- friend requests ----------
  const loadIncomingRequests = async () => {
    if (!token || !me?.id || me?.is_admin) return;
    try {
      const r = await fetch(`${API_BASE}/friends/requests?incoming=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw r;
      const d = await r.json();
      setFriendRequests(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      console.warn('Load friend requests failed:', e);
    }
  };
  useEffect(() => { loadIncomingRequests(); }, [token, me?.id]);

  // --------- WS ----------
  useEffect(() => {
    if (!me?.id || me?.is_admin || WS_DISABLED) return;
    let ws;
    try {
      ws = new WebSocket(`${WS_BASE}/ws/${me.id}`);
      ws.onopen = () => console.log('[WS] open');
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const isNotification = msg?.event === 'notification' || msg?.type === 'notification';
          if (isNotification && typeof msg.text === 'string') {
            setNotifications(prev => (msg.id && prev.some(x => x.id === msg.id) ? prev : [msg, ...prev]));
          }
        } catch (e) { console.warn('[WS] parse error:', e); }
      };
      ws.onerror = e => console.warn('[WS] error:', e);
      ws.onclose = e => console.log('[WS] closed', e.code, e.reason || '');
    } catch (e) { console.warn('[WS] init failed:', e); }
    return () => { try { ws && ws.close(); } catch {} };
  }, [me?.id]);

  const showToast = (message) => {
    const el = document.createElement('div');
    el.innerText = message;
    Object.assign(el.style, {
      position: 'fixed', right: '20px', bottom: '20px',
      background: '#333', color: '#fff', padding: '12px 16px',
      borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
      opacity: '1', transition: 'opacity .7s', zIndex: '9999', pointerEvents: 'none',
      fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 2200);
    setTimeout(() => { el.remove(); }, 3000);
  };

  const clearNotifications = async () => {
    try {
      const r = await fetch(`${API_BASE}/notifications/mark_all_read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('mark_all_read failed');
    } catch (e) { console.warn('Mark all read failed:', e); }
    setNotifications([]); setShowDropdown(false);
  };
  const markOneRead = async (id) => {
    try {
      const r = await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('mark one failed');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e) { console.warn('Mark one read failed:', e); }
  };

  const acceptFriend = async (id) => {
    setFriendRequests(prev => prev.filter(r => r.id !== id));
    try {
      const r = await fetch(`${API_BASE}/friends/requests/${id}/accept`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('accept failed');
      showToast('Đã chấp nhận lời mời.');
      window.dispatchEvent(new CustomEvent('friends:changed'));
    } catch (e) { console.warn('Accept friend failed:', e); loadIncomingRequests(); }
  };
  const declineFriend = async (id) => {
    setFriendRequests(prev => prev.filter(r => r.id !== id));
    try {
      const r = await fetch(`${API_BASE}/friends/requests/${id}/decline`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('reject failed');
      showToast('Đã từ chối lời mời.');
    } catch (e) { console.warn('Decline friend failed:', e); loadIncomingRequests(); }
  };

  const toggleNotif = () => { setShowFriendDropdown(false); setShowDropdown(v => !v); };
  const toggleFriends = async () => {
    setShowDropdown(false);
    const next = !showFriendDropdown;
    setShowFriendDropdown(next);
    if (next) await loadIncomingRequests();
  };

  const handleLoginSuccess = (t, meObj, meta) => {
    const isAdmin = Boolean(meta?.is_admin || meObj?.is_admin);

    setToken(t);
    setMe(meObj);
    localStorage.setItem('token', t);
    localStorage.setItem('me', JSON.stringify(meObj));

    if (isAdmin) {
      localStorage.removeItem('viewUserId');
      goto('/admin');
      return;
    }

    if (meObj?.id != null) {
      localStorage.setItem('viewUserId', String(meObj.id));
    }
    setPage('feed');
    goto('/');
  };

  const hideHeader = (page === 'login' || page === 'register') && route === '/';
  const isAuthedPage = !!token && !me?.is_admin && (page === 'feed' || page === 'search' || page === 'profile');

  return (
    <>
      {/* Ẩn topbar trên trang admin */}
      {!hideHeader && route !== '/admin' && !me?.is_admin && (
        <Topbar
          authed={!!token}
          userName={me?.display_name}
          me={me}
          notifications={notifications}
          showDropdown={showDropdown}
          onToggleDropdown={toggleNotif}
          onMarkAllRead={clearNotifications}
          onMarkOneRead={markOneRead}
          friendRequests={friendRequests}
          showFriendDropdown={showFriendDropdown}
          onToggleFriendDropdown={toggleFriends}
          onAcceptFriend={acceptFriend}
          onDeclineFriend={declineFriend}
          onLogout={logout}
          onNav={{
            feed:    () => { setPage('feed'); goto('/'); },
            search:  () => { setPage('search'); goto('/'); },
            profile: goMyProfile,
            login:   () => { setPage('login'); goto('/'); },
            register:() => { setPage('register'); goto('/'); },
          }}
        />
      )}

      {/* ---------- ROUTING ---------- */}
      {route === '/admin' ? (
        me?.is_admin ? (
          <AdminDashboard me={me} onLogout={logout} />
        ) : token ? (
          (() => { goto('/'); return null; })()
        ) : (
          <Login
            onSuccess={handleLoginSuccess}
            onSignUp={() => { setPage('register'); goto('/'); }}
          />
        )
      ) : (
        <>
          {/* 👉 Login/Register render full-width, KHÔNG bọc container 900px */}
          {page === 'login' && (
            <div key="login-page" className="page-transition">
              <Login
                onSuccess={handleLoginSuccess}
                onSignUp={() => { setPage('register'); goto('/'); }}
              />
            </div>
          )}

          {page === 'register' && (
            <div key="register-page" className="page-transition">
              <Register onDone={() => { setPage('login'); goto('/'); }} />
            </div>
          )}

          {/* Các trang sau đăng nhập mới bọc container 900px */}
          {isAuthedPage && (
            <main style={{ maxWidth: 900, margin: '0 auto', padding: 16, paddingTop: 88 }}>
              {page === 'feed'    && <Feed token={token} me={me} toast={toast} />}
              {page === 'search'  && (
                <SearchUser
                  token={token}
                  onOpenProfile={(u) => {
                    localStorage.setItem('viewUserId', u.id);
                    setPage('profile');
                  }}
                />
              )}
              {page === 'profile' && <Profile token={token} me={me} />}
            </main>
          )}
        </>
      )}

      {/* Toast Notifications */}
      <toast.ToastContainer />

      {/* Chat Button */}
      {isAuthedPage && <ChatButton />}
    </>
  );
}
