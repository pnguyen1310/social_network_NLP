// src/pages/Profile.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import http from "../api/http";
import "./profile.css";
import {
  UserPlus, Check, X, Mail, Calendar, IdCard,
  ThumbsUp, Trash2, MoreHorizontal, Camera
} from "lucide-react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";
const OK_AVATAR_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10MB

export default function Profile({ me }) {
  // ID đang xem (ưu tiên id được lưu từ Search)
  const viewUserId = useMemo(() => {
    const raw = localStorage.getItem("viewUserId");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : me?.id;
  }, [me?.id]);

  const isOwner = Number(me?.id) === Number(viewUserId);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // trạng thái kết bạn khi xem người khác
  const [friendStatus, setFriendStatus] = useState(isOwner ? "me" : "none"); // none|incoming|outgoing|friends|me
  const [requestId, setRequestId] = useState(null);

  // danh sách bạn của CHÍNH MÌNH
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // bài viết của user đang xem
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  // tabs
  const [tab, setTab] = useState("posts"); // mặc định Bài viết

  // menu “...” theo từng post
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  // ==== Avatar upload state ====
  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // đóng menu khi click ra ngoài / ESC / scroll / resize
  useEffect(() => {
    function close() { setOpenMenuId(null); }
    function onClickOutside(e) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) close();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  // ---------- Load hồ sơ ----------
  useEffect(() => {
    let active = true;
    setLoading(true);
    setProfile(null);
    setFriendStatus(isOwner ? "me" : "none");
    setRequestId(null);
    setTab("posts");
    setOpenMenuId(null);

    http.get(`/users/${viewUserId}`)
      .then((res) => active && setProfile(res.data))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [viewUserId, isOwner]);

  // ---------- Trạng thái bạn bè ----------
  useEffect(() => {
    if (!me?.id || isOwner) return;
    let active = true;
    http.get(`/friends/status`, { params: { user_id: viewUserId } })
      .then((res) => {
        if (!active) return;
        setFriendStatus(res.data?.status || "none");
        setRequestId(res.data?.request_id || null);
      })
      .catch(() => {
        if (!active) return;
        setFriendStatus("none");
        setRequestId(null);
      });
    return () => { active = false; };
  }, [me?.id, viewUserId, isOwner]);

  // ---------- Danh sách bạn của TÔI ----------
  const loadMyFriends = () => {
    if (!isOwner) return;
    setFriendsLoading(true);
    http.get(`/friends/of/${viewUserId}`, { params: { limit: 100 } })
      .then((res) => setFriends(res.data?.items || []))
      .finally(() => setFriendsLoading(false));
  };
  useEffect(() => { if (isOwner) loadMyFriends(); }, [isOwner, viewUserId]);

  // ---------- Bài viết của user đang xem ----------
  const loadPosts = () => {
    setPostsLoading(true);
    http.get(`/posts/`, { params: { user_id: viewUserId, limit: 50 } })
      .then((res) => setPosts(res.data?.items || []))
      .finally(() => setPostsLoading(false));
  };
  useEffect(() => { if (tab === "posts") loadPosts(); }, [tab, viewUserId]);

  // reload khi accept/decline ở header
  useEffect(() => {
    const onChanged = () => {
      if (isOwner && tab === "friends") loadMyFriends();
      if (tab === "posts") loadPosts();
    };
    window.addEventListener("friends:changed", onChanged);
    return () => window.removeEventListener("friends:changed", onChanged);
  }, [isOwner, tab, viewUserId]);

  // ---------- Actions ----------
  const sendFriendRequest = async () => {
    if (isOwner || friendStatus !== "none") return;
    try {
      const res = await http.post(`/friends/requests`, null, { params: { receiver_id: viewUserId } });
      setFriendStatus(res.data?.status || "outgoing");
      setRequestId(res.data?.request_id || null);
    } catch {
      alert("Gửi lời mời thất bại");
    }
  };

  const ensureRequestId = async () => {
    if (requestId) return requestId;
    const res = await http.get(`/friends/status`, { params: { user_id: viewUserId } });
    const rid = res.data?.request_id || null;
    setRequestId(rid);
    setFriendStatus(res.data?.status || friendStatus);
    return rid;
  };

  const acceptRequest = async () => {
    try {
      const rid = await ensureRequestId();
      if (!rid) return alert("Không tìm thấy lời mời.");
      await http.put(`/friends/requests/${rid}/accept`);
      setFriendStatus("friends");
      window.dispatchEvent(new CustomEvent("friends:changed"));
    } catch {
      alert("Chấp nhận thất bại");
    }
  };

  const rejectRequest = async () => {
    try {
      const rid = await ensureRequestId();
      if (!rid) return alert("Không tìm thấy lời mời.");
      await http.put(`/friends/requests/${rid}/decline`);
      setFriendStatus("none");
      setRequestId(null);
      window.dispatchEvent(new CustomEvent("friends:changed"));
    } catch {
      alert("Từ chối thất bại");
    }
  };

  // like / unlike ngay trong Profile
  const toggleLike = async (postId) => {
    try {
      const res = await http.post(`/posts/${postId}/like`);
      const newCount = res.data?.like_count ?? 0;
      const likedByMe = !!res.data?.liked_by_me;
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, like_count: newCount, liked_by_me: likedByMe } : p))
      );
    } catch {
      alert("Thao tác thích thất bại");
    }
  };

  // ====== XÓA BÀI VIẾT NGAY TRONG PROFILE ======
  const canDeletePost = (p) => {
    const meId = Number(me?.id);
    const auId = Number(p?.author?.id);
    const meEmail = me?.email?.toLowerCase?.();
    const auEmail = p?.author?.email?.toLowerCase?.();
    return (
      (Number.isFinite(meId) && Number.isFinite(auId) && meId === auId) ||
      (!!meEmail && !!auEmail && meEmail === auEmail) ||
      me?.is_admin === true
    );
  };

  const deletePost = async (postId) => {
    if (!window.confirm("Bạn có chắc muốn xóa bài viết này?")) return;
    try {
      await http.delete(`/posts/${postId}`);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setOpenMenuId(null);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Xóa không thành công";
      alert(msg);
    }
  };

  // ====== Avatar handlers ======
  const onPickAvatar = () => avatarInputRef.current?.click();

  const syncAppMeAvatar = (nextAvatarUrl) => {
    if (!isOwner || !me) return;
    const updatedMe = { ...me, avatar_url: nextAvatarUrl };
    localStorage.setItem("me", JSON.stringify(updatedMe));
    window.dispatchEvent(new CustomEvent("me:updated", { detail: updatedMe }));
  };

  const onChooseAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    if (f.size > MAX_AVATAR_SIZE) {
      alert("Ảnh quá lớn (tối đa 10MB).");
      e.target.value = "";
      return;
    }
    if (!OK_AVATAR_TYPES.includes(f.type)) {
      alert("Chỉ hỗ trợ PNG/JPG/WebP/GIF.");
      e.target.value = "";
      return;
    }

    try {
      setAvatarUploading(true);
      const fd = new FormData();
      fd.append("file", f);
      const res = await http.post("/users/me/avatar", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = res.data?.avatar_url || null;
      setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
      syncAppMeAvatar(url);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Upload avatar thất bại";
      alert(msg);
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  };

  const onRemoveAvatar = async () => {
    if (!profile?.avatar_url) return;
    if (!window.confirm("Gỡ ảnh đại diện?")) return;
    try {
      await http.delete("/users/me/avatar");
      setProfile((prev) => (prev ? { ...prev, avatar_url: null } : prev));
      syncAppMeAvatar(null);
    } catch {
      alert("Gỡ avatar thất bại");
    }
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "");
  const isVideo = (p) => p?.media_type === "video";

  if (loading || !profile) return <div className="profile-page">Đang tải…</div>;

  const avatarSrc = profile.avatar_url ? `${API_BASE}${profile.avatar_url}` : null;

  return (
    <div className="profile-page">
      {/* COVER + AVATAR + ACTIONS */}
      <section className="fb-cover">
        <div className="cover-img" />
        <div className="cover-bottom">
          {/* Avatar lớn */}
          <div className="avatar-lg">
            {avatarSrc && (
              <img src={avatarSrc} alt="avatar" draggable={false} />
            )}

            {isOwner && (
              <>
                <button
                  className="avatar-camera"
                  title={avatarUploading ? "Đang tải..." : "Đổi ảnh đại diện"}
                  onClick={onPickAvatar}
                  disabled={avatarUploading}
                  aria-label="Đổi ảnh đại diện"
                >
                  <Camera size={18} />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onChooseAvatar}
                />
              </>
            )}
          </div>

          <div className="name-block">
            <div className="name-row">
              <h1 className="display-name">{profile.display_name}</h1>
              {isOwner && profile.avatar_url && (
                <button
                  className="btn-link danger"
                  onClick={onRemoveAvatar}
                  disabled={avatarUploading}
                  title="Gỡ ảnh đại diện"
                >
                  <X size={14} />
                  <span>Gỡ avatar</span>
                </button>
              )}
            </div>
            <div className="muted">{profile.email}</div>
          </div>

          {!isOwner && (
            <div className="header-actions">
              {friendStatus === "none" && (
                <button className="btn-primary" onClick={sendFriendRequest}>
                  <UserPlus size={16} />
                  <span>Kết bạn</span>
                </button>
              )}
              {friendStatus === "outgoing" && (
                <button className="btn-disabled" disabled>Đã gửi lời mời</button>
              )}
              {friendStatus === "incoming" && (
                <div className="btn-row">
                  <button className="btn-primary" onClick={acceptRequest}>
                    <Check size={16} /><span>Chấp nhận</span>
                  </button>
                  <button className="btn-ghost" onClick={rejectRequest}>
                    <X size={16} /><span>Từ chối</span>
                  </button>
                </div>
              )}
              {friendStatus === "friends" && (
                <button className="btn-disabled" disabled>Đã là bạn bè</button>
              )}
            </div>
          )}
        </div>

        {/* TABS */}
        <div className="tabs">
          <button
            className={`tab ${tab === "posts" ? "active" : ""}`}
            onClick={() => setTab("posts")}
          >Bài viết</button>

          {isOwner && (
            <button
              className={`tab ${tab === "friends" ? "active" : ""}`}
              onClick={() => setTab("friends")}
            >Bạn bè</button>
          )}
        </div>
      </section>

      {/* BODY: 2 cột */}
      <div className="fb-body">
        <aside className="left-col">
          {/* Intro card */}
          <div className="card">
            <div className="card-title">Giới thiệu</div>
            <div className="intro-row">
              <Mail size={16} /> <span>{profile.email}</span>
            </div>
            {profile.date_of_birth && (
              <div className="intro-row">
                <Calendar size={16} /> <span>Sinh ngày: {profile.date_of_birth}</span>
              </div>
            )}
            <div className="intro-row">
              <IdCard size={16} /> <span>User ID: {profile.id}</span>
            </div>
            {profile.created_at && (
              <div className="intro-row muted">Tham gia: {fmt(profile.created_at)}</div>
            )}
          </div>
        </aside>

        <section className="right-col" ref={menuRef}>
          {tab === "posts" && (
            <div className="card">
              <div className="card-title">Bài viết</div>

              {postsLoading ? (
                <div className="muted">Đang tải bài viết…</div>
              ) : posts.length === 0 ? (
                <div className="muted">(Chưa có bài viết để hiển thị)</div>
              ) : (
                <div className="post-list">
                  {posts.map((p) => {
                    const auAvatar = p.author?.avatar_url ? `${API_BASE}${p.author.avatar_url}` : null;
                    return (
                      <article key={p.id} className="post-item">
                        <header className="post-hd">
                          <div className="avatar-sm" style={{ overflow: "hidden" }}>
                            {auAvatar && (
                              <img
                                src={auAvatar}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
                                draggable={false}
                              />
                            )}
                          </div>
                          <div className="meta">
                            <div className="name">{p.author?.display_name || "Người dùng"}</div>
                            <time className="time">{fmt(p.created_at)}</time>
                          </div>

                          {/* Nút ... và menu giống Feed */}
                          <div className="menu-wrap" style={{ marginLeft: "auto" }}>
                            <button
                              className="icon-btn"
                              title="Tùy chọn"
                              onClick={() => setOpenMenuId((id) => (id === p.id ? null : p.id))}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === p.id}
                            >
                              <MoreHorizontal size={20} />
                            </button>

                            {openMenuId === p.id && (
                              <div className="post-menu" role="menu">
                                {canDeletePost(p) ? (
                                  <button
                                    className="menu-item danger"
                                    onClick={() => deletePost(p.id)}
                                    role="menuitem"
                                  >
                                    <Trash2 size={16} />
                                    <span>Xóa bài viết</span>
                                  </button>
                                ) : (
                                  <div className="menu-item muted" role="menuitem" aria-disabled="true">
                                    Không có tùy chọn
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </header>

                        {!!p.content && <div className="post-txt">{p.content}</div>}

                        {p.media_url && (
                          isVideo(p) ? (
                            <video className="post-media" controls src={`${API_BASE}${p.media_url}`} />
                          ) : (
                            <img className="post-media" src={`${API_BASE}${p.media_url}`} alt="" />
                          )
                        )}

                        <div className="post-ft">
                          <button
                            className={`like-btn ${p.liked_by_me ? "active" : ""}`}
                            onClick={() => toggleLike(p.id)}
                            title={p.liked_by_me ? "Đã thích" : "Thích"}
                          >
                            <ThumbsUp size={16} />
                            <span>{p.liked_by_me ? "Đã thích" : "Thích"}</span>
                          </button>
                          <div className="like-count">{p.like_count ?? 0} lượt thích</div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "friends" && isOwner && (
            <div className="card">
              <div className="card-title">
                Bạn bè <span className="muted">({friends.length})</span>
              </div>

              {friendsLoading ? (
                <div className="muted">Đang tải danh sách bạn…</div>
              ) : friends.length ? (
                <div className="friends-grid">
                  {friends.map((f) => (
                    <div className="friend-item" key={f.friend_id}>
                      <div className="avatar-md" />
                      <div className="friend-name">{f.display_name}</div>
                      <div className="friend-sub muted">{f.email}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">Bạn chưa có bạn bè nào.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
