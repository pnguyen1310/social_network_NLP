// src/pages/Feed.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ImagePlus, Globe, X, MessageCircle, ThumbsUp } from 'lucide-react';
import http from '../api/http';
import PostItem from '../components/PostItem';
import './feed.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export default function Feed({ token, me, toast }) {
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // current user (để biết ai là chính chủ & hiện avatar composer)
  const [currentUser, setCurrentUser] = useState(null);

  // upload state
  const [mediaFile, setMediaFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInputRef = useRef(null);

  // modal
  const [showModal, setShowModal] = useState(false);
  const [activePost, setActivePost] = useState(null);
  const [activeDraft, setActiveDraft] = useState('');

  // edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPost, setEditPost] = useState(null);
  const [editContent, setEditContent] = useState('');

  // menu "..." theo từng post
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  // headers
  const authHeaders = useMemo(() => ({ Authorization: 'Bearer ' + token }), [token]);
  const jsonHeaders = useMemo(
    () => ({ ...authHeaders, 'Content-Type': 'application/json' }),
    [authHeaders]
  );

  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const isVideo = (f) => !!f && f.type?.startsWith('video/');

  const pickFile = () => fileInputRef.current?.click();
  const onChooseFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      toast?.error('File quá lớn (tối đa 20MB).');
      e.target.value = '';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setMediaFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };
  const clearChosen = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setMediaFile(null);
    setPreviewUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { document.body.style.overflow = ''; }, []);

  // ---- LOAD ME (ưu tiên /users/me để có avatar_url mới nhất)
  const normalizeUser = (u) => {
    if (!u) return null;
    if (u.user && (u.user.id != null || u.user.email)) return u.user;
    return u;
  };

  const loadMe = async () => {
    // 1) API đúng: /users/me
    try {
      const r0 = await http.get('/users/me', { headers: authHeaders });
      const me0 = normalizeUser(r0.data);
      if (me0) {
        setCurrentUser(me0);
        localStorage.setItem('user', JSON.stringify(me0));
        return;
      }
    } catch (_) {}

    // 2) Fallback: /auth/me (nếu có)
    try {
      const r1 = await http.get('/auth/me', { headers: authHeaders });
      const me1 = normalizeUser(r1.data);
      if (me1) {
        setCurrentUser(me1);
        localStorage.setItem('user', JSON.stringify(me1));
        return;
      }
    } catch (_) {}

    // 3) Cuối cùng: cache
    try {
      const cached = localStorage.getItem('user');
      if (cached) {
        const me = normalizeUser(JSON.parse(cached));
        if (me) { setCurrentUser(me); return; }
      }
    } catch (_) {
      setCurrentUser(null);
    }
  };

  const loadPosts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await http.get('/posts/'); // interceptor tự gắn Authorization
      setPosts(res.data.items || res.data || []);
    } catch (e) {
      console.error(e);
      setError('Không tải được bài viết. Kiểm tra backend / token.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadMe();
      loadPosts();
    }
  }, [token]);

  // Tự làm mới avatar composer khi đổi/gỡ ở Profile
  useEffect(() => {
    const h = () => loadMe();
    window.addEventListener('me:updated', h);
    return () => window.removeEventListener('me:updated', h);
  }, []);

  const createPost = async () => {
    const text = content.trim();
    if (!text && !mediaFile) return;

    try {
      let res;
      
      if (mediaFile) {
        const fd = new FormData();
        fd.append('content', text || '');
        fd.append('media', mediaFile);
        res = await http.post('/posts/', fd, { headers: authHeaders });
      } else {
        res = await http.post('/posts/', { content: text }, { headers: jsonHeaders });
      }
      setPosts((prev) => [res.data, ...prev]);
      toast?.success('Đăng bài thành công!');
      
      setContent('');
      clearChosen();
    } catch (e) {
      console.error('[POST /posts] error:', e);
      toast?.error('Đăng bài thất bại');
    }
  };

  // Update post
  const updatePost = async () => {
    const text = editContent.trim();
    if (!text) return;

    try {
      const res = await http.put(`/posts/${editPost.id}`, { content: text }, { headers: jsonHeaders });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === editPost.id ? { ...p, content: text } : p
        )
      );
      toast?.success('Cập nhật bài viết thành công!');
      setShowEditModal(false);
      setEditPost(null);
      setEditContent('');
    } catch (e) {
      console.error('[PUT /posts] error:', e);
      toast?.error('Cập nhật bài viết thất bại');
    }
  };

  // Toggle like
  const toggleLike = async (postId, inModal = false) => {
    try {
      const res = await http.post(`/posts/${postId}/like`, {}, { headers: jsonHeaders });
      const newCount = res.data?.like_count ?? 0;
      const likedByMe = !!res.data?.liked_by_me;

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, like_count: newCount, liked_by_me: likedByMe } : p
        )
      );

      if (inModal && activePost?.id === postId) {
        setActivePost((prev) => (prev ? { ...prev, like_count: newCount, liked_by_me: likedByMe } : prev));
      }
    } catch (e) {
      console.error(e);
      toast?.error('Like thất bại');
    }
  };

  const loadComments = async (postId, keepModal = false) => {
    try {
      const res = await http.get(`/posts/${postId}/comments`, { headers: authHeaders });
      if (keepModal) {
        setActivePost((prev) => prev && prev.id === postId ? { ...prev, comments: res.data } : prev);
      } else {
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, comments: res.data } : p)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addComment = async (postId, text, inModal = false) => {
    const clean = (text || '').trim(); if (!clean) return;
    try {
      const res = await http.post(`/posts/${postId}/comments`, { content: clean }, { headers: jsonHeaders });
      const newComment = res.data;
      if (inModal) {
        setActivePost((prev) => prev ? { ...prev, comments: [...(prev.comments || []), newComment] } : prev);
        setActiveDraft('');
      } else {
        setPosts((prev) => prev.map((p) => p.id === postId
          ? { ...p, comments: [...(p.comments || []), newComment] }
          : p));
      }
    } catch (e) { console.error(e); toast?.error('Bình luận thất bại'); }
  };

  // ===== XÓA BÀI VIẾT (chỉ chính chủ) =====
  const deletePost = async (postId) => {
    if (!window.confirm('Bạn có chắc muốn xóa bài viết này?')) return;
    try {
      await http.delete(`/posts/${postId}`, { headers: authHeaders });
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      if (activePost?.id === postId) closePostModal();
      setOpenMenuId(null);
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.detail || 'Xóa không thành công';
      alert(msg);
    }
  };

  const openPostModal = async (post) => {
    document.body.style.overflow = 'hidden';
    try {
      const res = await http.get(`/posts/${post.id}/comments`, { headers: authHeaders });
      setActivePost({ ...post, comments: res.data });
      setActiveDraft('');
      setShowModal(true);
    } catch (e) { console.error(e); }
  };
  const closePostModal = () => {
    document.body.style.overflow = '';
    setShowModal(false);
    setActivePost(null);
    setActiveDraft('');
  };

  // Đóng menu khi click ra ngoài
  useEffect(() => {
    if (openMenuId == null) return;
    const handler = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  const canPost = content.trim() || mediaFile;

  return (
    <div className="feed-page">
      {loading && <div className="feed-loading">Đang tải bài viết...</div>}
      {!!error && <div className="feed-error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="feed-container">
            {/* Composer */}
            <div className="composer-card">
              <div className="composer-top">
                <Avatar size={40} user={currentUser} />
                <div className="composer-input">
                  <textarea
                    placeholder="Bạn đang nghĩ gì thế?"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              {!!previewUrl && (
                <div className="compose-preview">
                  {isVideo(mediaFile) ? (
                    <video controls className="post-media" src={previewUrl} />
                  ) : (
                    <img className="post-media" src={previewUrl} alt="preview" />
                  )}
                  <button className="remove-preview" onClick={clearChosen} title="Gỡ tệp">×</button>
                </div>
              )}

              <div className="composer-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                  onChange={onChooseFile}
                />
                <button className="btn-action" onClick={pickFile} title="Thêm ảnh/video">
                  <ImagePlus className="icon-sm" size={18} />
                  <span>Ảnh/Video</span>
                </button>
                <button className="btn-primary" onClick={createPost} disabled={!canPost}>
                  Đăng bài
                </button>
              </div>
            </div>

            {/* Feed list */}
            <div className="feed-list" ref={menuRef}>
              {posts.map((p) => {
                const meId = Number(currentUser?.id);
                const auId = Number(p?.author?.id);
                const canDelete =
                  (Number.isFinite(meId) && Number.isFinite(auId) && meId === auId) ||
                  currentUser?.is_admin === true;

                return (
                  <PostItem
                    key={p.id}
                    post={p}
                    onLike={(postId) => toggleLike(postId, false)}
                    onComment={() => openPostModal(p)}
                    onDelete={canDelete ? deletePost : null}
                    onEdit={canDelete ? (postId) => {
                      const post = posts.find(x => x.id === postId);
                      if (post) {
                        setEditPost(post);
                        setEditContent(post.content || '');
                        setShowEditModal(true);
                      }
                    } : null}
                    onReport={async (postId) => {
                      if (!window.confirm('Bạn có muốn báo cáo bài viết này?')) return;
                      try {
                        await http.post(`/posts/${postId}/report`, null, { headers: authHeaders });
                        toast?.info('Cảm ơn bạn đã báo cáo. Chúng tôi sẽ xem xét.');
                      } catch (e) {
                        const msg = e?.response?.data?.detail || e?.response?.data?.message || 'Không thể gửi báo cáo.';
                        toast?.error(msg);
                      }
                    }}
                    isLiked={!!p.liked_by_me}
                    currentUserId={currentUser?.id}
                  />
                );
              })}
            </div>
          </div>

          {/* Modal chi tiết */}
          {showModal && activePost && (
            <div className="modal" onClick={(e) => e.target === e.currentTarget && closePostModal()}>
              <div className="modal-card">
                <header className="modal-header">
                  <div className="userline">
                    <Avatar size={36} user={activePost.author} />
                    <div>
                      <div className="post-author">{activePost.author?.display_name || 'Người dùng'}</div>
                      <div className="post-submeta">
                        <time>{fmtTime(activePost.created_at)}</time>
                        <span className="sep">·</span>
                        <span className="aud"><Globe size={14} /></span>
                      </div>
                    </div>
                  </div>
                  <button className="icon-btn lg" onClick={closePostModal} title="Đóng"><X size={22} /></button>
                </header>

                <div className="modal-body">
                  <div className="modal-content">
                    <div className="post-content">{activePost.content}</div>
                    {activePost.media_url && (
                      activePost.media_type === 'video'
                        ? <video className="post-media" controls src={`${API_BASE}${activePost.media_url}`} />
                        : <img className="post-media" src={`${API_BASE}${activePost.media_url}`} alt="" />
                    )}
                  </div>

                  <div className="comments">
                    {activePost.comments?.length ? (
                      activePost.comments.map((c) => (
                        <div key={c.id} className="comment">
                          <Avatar size={32} user={c.author} />
                          <div className="bubble">
                            <div className="name">{c.author?.display_name || 'Người dùng'}</div>
                            <div className="text">{c.content}</div>
                          </div>
                          <div className="meta"><time>{fmtTime(c.created_at)}</time></div>
                        </div>
                      ))
                    ) : <div className="no-comments">Chưa có bình luận nào.</div>}
                  </div>
                </div>

                <div className="post-stats modal-stats">
                  <div className="reactions">
                    <span className="circle like"><ThumbsUp size={14} /></span>
                    <span className="count">{activePost.like_count ?? 0}</span>
                  </div>
                  <div className="stats-right" />
                </div>

                <div className="post-actions">
                  <ActionButton
                    label="Thích"
                    icon={ThumbsUp}
                    onClick={() => toggleLike(activePost.id, true)}
                    active={!!activePost.liked_by_me}
                  />
                  <ActionButton label="Bình luận" icon={MessageCircle} onClick={() => {}} />
                </div>

                <div className="comment-composer">
                  <Avatar size={32} user={currentUser} />
                  <div className="input-wrap">
                    <textarea
                      placeholder="Viết bình luận..."
                      value={activeDraft}
                      onChange={(e) => setActiveDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const text = activeDraft.trim();
                          if (text) await addComment(activePost.id, text, true);
                        }
                      }}
                      rows={1}
                    />
                    <button
                      className="btn-primary sm"
                      onClick={async () => {
                        const text = activeDraft.trim();
                        if (text) await addComment(activePost.id, text, true);
                      }}
                    >Gửi</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {showEditModal && editPost && (
            <div className="modal" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
              <div className="modal-card edit-modal">
                <header className="modal-header">
                  <div className="userline">
                    <Avatar size={36} user={editPost.author} />
                    <div>
                      <div className="post-author">{editPost.author?.display_name || 'Người dùng'}</div>
                      <div className="post-submeta">
                        <time>{fmtTime(editPost.created_at)}</time>
                      </div>
                    </div>
                  </div>
                  <button className="icon-btn lg" onClick={() => setShowEditModal(false)} title="Đóng"><X size={22} /></button>
                </header>

                <div className="modal-body">
                  <div className="edit-textarea-wrapper">
                    <textarea
                      className="edit-textarea"
                      placeholder="Sửa nội dung bài viết..."
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid #e4e6eb' }}>
                  <button
                    className="btn-cancel"
                    onClick={() => setShowEditModal(false)}
                  >
                    Hủy
                  </button>
                  <button
                    className="btn-primary"
                    onClick={updatePost}
                    disabled={!editContent.trim()}
                  >
                    Lưu
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* bits */
function Avatar({ user, src, size = 40 }) {
  const url = src
    ? src
    : user?.avatar_url
      ? `${API_BASE}${user.avatar_url}`
      : null;

  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'linear-gradient(135deg,#e5e7eb,#f8fafc)',
        flex: '0 0 auto'
      }}
    >
      {url && (
        <img
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          draggable={false}
        />
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, active }) {
  const finalLabel = active ? 'Đã thích' : label;
  return (
    <button
      className={`action-btn${active ? ' active' : ''}`}
      onClick={onClick}
      type="button"
      aria-label={finalLabel}
      aria-pressed={!!active}
      title={finalLabel}
    >
      <Icon className="action-icon" /><span>{finalLabel}</span>
    </button>
  );
}
