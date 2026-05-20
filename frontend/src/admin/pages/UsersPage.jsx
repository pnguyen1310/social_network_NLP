import React, { useEffect, useState } from 'react';
import DataTable from '../components/cards/DataTable';
import { admin as api } from '../api';
import './UsersPage.css';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000';

function toAvatarUrl(rawUrl) {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  return `${API_BASE}${rawUrl}`;
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, [searchQ]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await api.users({ q: searchQ, limit: 50 });
      setUsers(data.items || []);
    } catch (e) {
      console.warn('Load users failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xóa tài khoản này?')) return;
    try {
      await api.deleteUser(id);
      setUsers(users.filter(u => u.id !== id));
    } catch (e) {
      alert('Xóa thất bại');
    }
  };

  return (
    <div className="users-page">
      <div className="page-header">
        <h2>Quản lý người dùng</h2>
        <div className="search-box">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc email..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        title={`Danh sách người dùng (${users.length})`}
        columns={[
          { key: 'id', label: 'ID', width: '60px' },
          {
            key: 'display_name',
            label: 'Tên hiển thị',
            render: (v, row) => {
              const avatarUrl = toAvatarUrl(row?.avatar_url);
              const fallback = (v || row?.email || 'U').charAt(0).toUpperCase();
              return (
                <div className="user-name-cell">
                  <div className="user-avatar-mini" aria-hidden="true">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={v || row?.email || 'User avatar'} loading="lazy" />
                    ) : (
                      <span>{fallback}</span>
                    )}
                  </div>
                  <span className="user-name-text">{v || '?'}</span>
                </div>
              );
            },
          },
          { key: 'email', label: 'Email' },
          { key: 'post_count', label: 'Bài đăng', width: '80px', render: (v) => v || 0 },
          { key: 'created_at', label: 'Ngày tạo', render: (v) => v ? new Date(v).toLocaleDateString() : '?' },
        ]}
        data={users}
        onDelete={(id) => {
          const u = users.find(x => x.id === id);
          if (u?.is_admin) return alert('Không xóa admin');
          handleDelete(id);
        }}
        loading={loading}
      />
    </div>
  );
}
