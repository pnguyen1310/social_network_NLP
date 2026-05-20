import React, { useEffect, useMemo, useState } from "react"; 
import { admin as api } from "../api"; 
import { Eye, Trash2, LogOut } from 'lucide-react'; // Import icon từ lucide-react 
import '../styles/AdminLayout.css'; // Đảm bảo đường dẫn chính xác 

// Card component 
function Card({ title, children, right }) { 
  return ( 
    <div className="card"> 
      <div className="header"> 
        <div className="card-title">{title}</div> 
        {right} 
      </div> 
      {children} 
    </div> 
  ); 
} 

// Empty component 
function Empty({ icon = "📭", text = "Chưa có dữ liệu." }) { 
  return <div className="empty"><span style={{ opacity: .9 }}>{icon}</span>&nbsp;<span className="small">{text}</span></div>; 
} 

// RowActions component with icons 
function RowActions({ onView, onDelete, disableDelete }) { 
  return ( 
    <div style={{ display: "flex", gap: 8 }}> 
      <button className="btn" onClick={onView} title="Xem chi tiết"> 
        <Eye size={18} /> Xem 
      </button> 
      <button className="btn danger" disabled={disableDelete} onClick={onDelete} title="Xoá vĩnh viễn"> 
        <Trash2 size={18} /> Xoá 
      </button> 
    </div> 
  ); 
} 

// Custom hook for debounced value 
function useDebouncedValue(value, delay = 450) { 
  const [v, setV] = useState(value); 
  useEffect(() => { 
    const t = setTimeout(() => setV(value), delay); 
    return () => clearTimeout(t); 
  }, [value, delay]); 
  return v; 
} 

export default function AdminLayout({ me, token, onNav }) { 
  const [tab, setTab] = useState("dashboard"); 
  useEffect(() => { 
    if (!me?.is_admin) onNav?.("/"); 
  }, [me]); 

  // Dashboard 
  const [stats, setStats] = useState(null); 
  const [loadingStats, setLoadingStats] = useState(false); 
  const topLiked = useMemo( 
    () => (stats?.top_liked?.length ? stats.top_liked[0] : null), 
    [stats] 
  ); 

  // Posts 
  const [posts, setPosts] = useState([]); 
  const [qPost, setQPost] = useState(""); 
  const dqPost = useDebouncedValue(qPost, 500); 
  const [loadingPosts, setLoadingPosts] = useState(false); 

  // Users 
  const [users, setUsers] = useState([]); 
  const [qUser, setQUser] = useState(""); 
  const dqUser = useDebouncedValue(qUser, 500); 
  const [loadingUsers, setLoadingUsers] = useState(false); 

  // Reports 
  const [reports, setReports] = useState([]); 
  const [loadingReports, setLoadingReports] = useState(false); 

  // Loaders 
  const loadStats = async () => { 
    try { 
      setLoadingStats(true); 
      const d = await api.stats(); 
      setStats(d); 
    } catch (e) { 
      console.warn(e); 
    } finally { 
      setLoadingStats(false); 
    } 
  }; 

  const loadPosts = async () => { 
    try { 
      setLoadingPosts(true); 
      const d = await api.posts({ q: dqPost, limit: 20 }); 
      setPosts(d.items || []); 
    } catch (e) { 
      console.warn(e); 
    } finally { 
      setLoadingPosts(false); 
    } 
  }; 

  const loadUsers = async () => { 
    try { 
      setLoadingUsers(true); 
      const d = await api.users({ q: dqUser, limit: 50 }); 
      setUsers(d.items || []); 
    } catch (e) { 
      console.warn(e); 
    } finally { 
      setLoadingUsers(false); 
    } 
  }; 

  const loadReports = async () => { 
    try { 
      setLoadingReports(true); 
      const token = localStorage.getItem('token'); 
      const response = await fetch('http://localhost:8000/admin/reports', { 
        headers: { 'Authorization': `Bearer ${token}` } 
      }); 
      if (!response.ok) {
        console.error('Failed to fetch reports:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}`);
      }
      const d = await response.json(); 
      console.log('Reports loaded:', d.items?.length || 0, d.items);
      setReports(d.items || []); 
    } catch (e) { 
      console.error('Error loading reports:', e); 
    } finally { 
      setLoadingReports(false); 
    } 
  }; 

  useEffect(() => { 
    if (tab === "dashboard") loadStats(); 
  }, [tab]); 

  useEffect(() => { 
    if (tab === "posts") loadPosts(); 
  }, [tab, dqPost]); 

  useEffect(() => { 
    if (tab === "users") loadUsers(); 
  }, [tab, dqUser]); 

  useEffect(() => { 
    if (tab === "reports") loadReports(); 
  }, [tab]); 

  // Actions 
  const delPost = async (id) => { 
    if (!confirm("Xoá bài viết này?")) return; 
    try { 
      await api.deletePost(id); 
      loadPosts(); 
    } catch (e) { 
      alert("Xoá thất bại"); 
    } 
  }; 

  const delUser = async (id) => { 
    if (!confirm("Xoá tài khoản này?")) return; 
    try { 
      await api.deleteUser(id); 
      loadUsers(); 
    } catch (e) { 
      alert("Xoá thất bại"); 
    } 
  }; 

  // Handle logout 
 const handleLogout = () => {
  if (!window.confirm('Bạn có chắc muốn đăng xuất?')) return;
  
  // Xóa token khỏi localStorage (hoặc sessionStorage tùy vào cách bạn lưu token)
  localStorage.removeItem("token");  // Nếu bạn lưu token trong localStorage
  // Hoặc nếu bạn sử dụng sessionStorage:
  // sessionStorage.removeItem("token");

  // Chuyển hướng về trang đăng nhập (login)
  window.location.href = "/login";  // Hoặc bạn có thể sử dụng `history.push("/login")` nếu dùng react-router
  }; 

  return ( 
    <div className="admin-page"> 
      {/* Admin page wrapper */} 
      <div className="container"> 
        <div className="header"> 
          <div className="h1">Admin Console</div> 
          <div className="logout-btn"> 
            <button className="btn danger" onClick={handleLogout}> 
              <LogOut size={18} /> Đăng xuất 
            </button> 
          </div> 
        </div> 
        <div className="subtitle">Quản trị hệ thống</div> 
        <div className="tabs" role="tablist" aria-label="Admin tabs"> 
          {["dashboard", "posts", "users", "reports"].map(k => ( 
            <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}> 
              {k.charAt(0).toUpperCase() + k.slice(1)} 
            </button> 
          ))} 
        </div> 
        {/* Dashboard */} 
        {tab === "dashboard" && ( 
          <> 
            <div style={{ marginTop: 16 }} /> 
            <div className="grid-3"> 
              <Card title="Tổng số người dùng" right={<span className="badge"><span className="dot" /> realtime</span>}> 
                <div className="kpi">{loadingStats ? <span className="spinner" /> : (stats?.totals?.users ?? "—")}</div> 
              </Card> 
              <Card title="Tổng số bài viết"> 
                <div className="kpi">{loadingStats ? <span className="spinner" /> : (stats?.totals?.posts ?? "—")}</div> 
              </Card> 
              <Card title="Tổng số bình luận"> 
                <div className="kpi">{loadingStats ? <span className="spinner" /> : (stats?.totals?.comments ?? "—")}</div> 
              </Card> 
            </div> 
            {/* Top liked posts */} 
            <div style={{ marginTop: 16 }}> 
              <Card title="Bài được yêu thích nhất" right={loadingStats ? <span className="small">Đang tải…</span> : topLiked && <span className="badge"><span className="dot" /> {topLiked.likes} ♥</span>}> 
                {!topLiked ? <Empty text="Chưa có dữ liệu / chưa có bảng likes." /> : ( 
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}> 
                    <div style={{ flex: 1 }}> 
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>#{topLiked.id}</div> 
                      <div style={{ opacity: .9 }}> {topLiked.content?.slice(0, 160) || "(no content)"}{(topLiked.content || "").length > 160 ? "…" : ""} </div> 
                    </div> 
                    <div className="rightActions"> 
                      <button className="btn" onClick={async () => { const d = await api.postDetail(topLiked.id); alert(JSON.stringify(d, null, 2)); }}> 
                        <Eye size={18} /> Xem 
                      </button> 
                    </div> 
                  </div> 
                )} 
              </Card> 
            </div> 
          </> 
        )} 
        {/* Posts */} 
        {tab === "posts" && ( 
          <div style={{ marginTop: 16 }}> 
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}> 
              <input className="input" value={qPost} onChange={e => setQPost(e.target.value)} placeholder="Tìm theo nội dung…" /> 
              <button className="btn brand" onClick={loadPosts}>{loadingPosts ? "Đang tìm…" : "Tìm"}</button> 
            </div> 
            <Card title="Danh sách bài viết" right={loadingPosts ? <span className="small">Đang tải…</span> : null}> 
              {!posts.length ? <Empty /> : ( 
                <table className="table"> 
                  <thead> 
                    <tr> 
                      <th>ID</th> 
                      <th style={{ width: "55%" }}>Nội dung</th> 
                      <th>Tác giả</th> 
                      <th>Hành động</th> 
                    </tr> 
                  </thead> 
                  <tbody> 
                    {posts.map(p => ( 
                      <tr key={p.id}> 
                        <td>#{p.id}</td> 
                        <td>{p.content?.slice(0, 120) || "(no content)"}…</td> 
                        <td>{p.author?.display_name || "(?)"}</td> 
                        <td> 
                          <RowActions onView={async () => { const d = await api.postDetail(p.id); alert(JSON.stringify(d, null, 2)); }} onDelete={() => delPost(p.id)} /> 
                        </td> 
                      </tr> 
                    ))} 
                  </tbody> 
                </table> 
              )} 
            </Card> 
          </div> 
        )} 
        {/* Users */} 
        {tab === "users" && ( 
          <div style={{ marginTop: 16 }}> 
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}> 
              <input className="input" value={qUser} onChange={e => setQUser(e.target.value)} placeholder="Tìm tên hoặc email…" /> 
              <button className="btn brand" onClick={loadUsers}>{loadingUsers ? "Đang tìm…" : "Tìm"}</button> 
            </div> 
            <Card title="Danh sách tài khoản" right={loadingUsers ? <span className="small">Đang tải…</span> : null}> 
              {!users.length ? <Empty /> : ( 
                <table className="table"> 
                  <thead> 
                    <tr> 
                      <th>ID</th> 
                      <th>Tên hiển thị</th> 
                      <th>Email</th> 
                      <th>Role</th> 
                      <th>Hành động</th> 
                    </tr> 
                  </thead> 
                  <tbody> 
                    {users.map(u => ( 
                      <tr key={u.id}> 
                        <td>#{u.id}</td> 
                        <td>{u.display_name}</td> 
                        <td>{u.email}</td> 
                        <td>{u.is_admin ? "ADMIN" : "USER"}</td> 
                        <td> 
                          {u.is_admin ? <em className="small">Không xoá admin</em> : <button className="btn danger" onClick={() => delUser(u.id)}><Trash2 size={18} /> Xoá</button>} 
                        </td> 
                      </tr> 
                    ))} 
                  </tbody> 
                </table> 
              )} 
            </Card> 
          </div> 
        )} 

        {/* Reports */} 
        {tab === "reports" && ( 
          <div style={{ marginTop: 16 }}> 
            <Card title={`Báo cáo (${reports.length})`}> 
              {loadingReports && <div style={{ padding: 16 }}>Đang tải...</div>} 
              {!loadingReports && reports.length === 0 && <Empty text="Chưa có báo cáo nào" />} 
              {!loadingReports && reports.length > 0 && ( 
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}> 
                  {reports.map(r => ( 
                    <div key={r.id} style={{ 
                      border: '1px solid #e5e7eb', 
                      borderRadius: 8, 
                      padding: 16, 
                      background: '#fff' 
                    }}> 
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        marginBottom: 12, 
                        paddingBottom: 12, 
                        borderBottom: '1px solid #e5e7eb' 
                      }}> 
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}> 
                          <span style={{ 
                            background: '#fee2e2', 
                            color: '#ef4444', 
                            padding: '4px 12px', 
                            borderRadius: 12, 
                            fontSize: 13, 
                            fontWeight: 600 
                          }}>#{r.id}</span> 
                          <span style={{ fontSize: 13, color: '#6b7280' }}> 
                            {new Date(r.created_at).toLocaleString('vi-VN')} 
                          </span> 
                        </div> 
                        {r.reporter && ( 
                          <span style={{ fontSize: 13, color: '#6b7280' }}> 
                            Báo cáo bởi: <strong>{r.reporter.display_name || r.reporter.username}</strong> 
                          </span> 
                        )} 
                      </div> 
                      {r.reason && ( 
                        <div style={{ marginBottom: 12, fontSize: 14 }}> 
                          <strong>Lý do:</strong> {r.reason} 
                        </div> 
                      )} 
                      {r.post && ( 
                        <div style={{ 
                          background: '#f9fafb', 
                          border: '1px solid #e5e7eb', 
                          borderRadius: 6, 
                          padding: 12 
                        }}> 
                          <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            marginBottom: 8 
                          }}> 
                            <span style={{ 
                              fontSize: 13, 
                              fontWeight: 600, 
                              color: '#6366f1', 
                              background: '#eef2ff', 
                              padding: '4px 12px', 
                              borderRadius: 12 
                            }}> 
                              Bài viết #{r.post.id} 
                            </span> 
                            {r.post.author && ( 
                              <span style={{ fontSize: 13, color: '#6b7280' }}> 
                                Đăng bởi: {r.post.author.display_name || r.post.author.username} 
                              </span> 
                            )} 
                          </div> 
                          <div style={{ fontSize: 14, marginBottom: 8 }}> 
                            {r.post.content} 
                          </div> 
                          {r.post.media_url && ( 
                            <div style={{ 
                              marginTop: 8, 
                              borderRadius: 6, 
                              overflow: 'hidden', 
                              maxHeight: 300, 
                              background: '#000', 
                              display: 'flex', 
                              justifyContent: 'center' 
                            }}> 
                              {r.post.media_url.match(/\.(mp4|webm|ogg)$/i) ? ( 
                                <video controls style={{ maxWidth: '100%', maxHeight: 300 }} 
                                  src={`http://localhost:8000${r.post.media_url}`} /> 
                              ) : ( 
                                <img style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }} 
                                  src={`http://localhost:8000${r.post.media_url}`} alt="Post" /> 
                              )} 
                            </div> 
                          )} 
                          <div style={{ 
                            display: 'flex', 
                            gap: 16, 
                            marginTop: 8, 
                            paddingTop: 8, 
                            borderTop: '1px solid #e5e7eb', 
                            fontSize: 13, 
                            color: '#6b7280' 
                          }}> 
                            <span>{r.post.like_count || 0} lượt thích</span> 
                            <span>{r.post.comment_count || 0} bình luận</span> 
                          </div> 
                        </div> 
                      )} 
                    </div> 
                  ))} 
                </div> 
              )} 
            </Card> 
          </div> 
        )} 
      </div> 
    </div> 
  ); 
}
