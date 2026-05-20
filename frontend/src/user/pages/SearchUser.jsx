import React, { useEffect, useRef, useState } from "react";
import http from "../api/http";
import "./search.css";
import { Search, UserPlus, Check, X, User } from "lucide-react";

export default function SearchUser({ token, onOpenProfile }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [statusMap, setStatusMap] = useState({});

  // id các request để tránh ghi đè khi gõ nhanh
  const reqSeq = useRef(0);

  const canSearch = q.trim().length > 0;

  // --- core search (dùng cho debounce & cho nút/Enter) ---
  const runSearch = async (queryText) => {
    const mySeq = ++reqSeq.current;           // đánh dấu request hiện tại
    if (!queryText) {
      setResults([]); setStatusMap({}); return;
    }
    setLoading(true);
    try {
      const res = await http.get("/users/", { params: { q: queryText, limit: 20 } });
      if (mySeq !== reqSeq.current) return;   // bị lỗi thời -> bỏ
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      setResults(items);

      // lấy friend status cho từng user (song song)
      const statuses = await Promise.all(
        items.map((u) =>
          http
            .get("/friends/status", { params: { user_id: u.id } })
            .then((r) => ({ id: u.id, status: r.data?.status || "none", request_id: r.data?.request_id || null }))
            .catch(() => ({ id: u.id, status: "none", request_id: null }))
        )
      );
      if (mySeq !== reqSeq.current) return;   // vẫn đảm bảo đúng lượt
      const map = {};
      statuses.forEach((s) => (map[s.id] = { status: s.status, request_id: s.request_id }));
      setStatusMap(map);
    } catch (e) {
      if (mySeq !== reqSeq.current) return;
      console.warn("search users failed:", e);
      setResults([]); setStatusMap({});
    } finally {
      if (mySeq === reqSeq.current) setLoading(false);
    }
  };

  // --- debounce: tự tìm sau 350ms khi người dùng gõ ---
  useEffect(() => {
    const queryText = q.trim();
    if (!queryText) {
      setResults([]); setStatusMap({}); setLoading(false);
      return;
    }
    const t = setTimeout(() => runSearch(queryText), 350);
    return () => clearTimeout(t);
  }, [q]);

  // --- handlers nút/Enter (tìm ngay, bỏ qua debounce) ---
  const doSearchNow = () => runSearch(q.trim());

  // --- friend actions ---
  const sendRequest = async (userId) => {
    try {
      await http.post("/friends/requests", null, { params: { receiver_id: userId } });
      setStatusMap((m) => ({ ...m, [userId]: { status: "outgoing", request_id: m[userId]?.request_id || null } }));
    } catch { alert("Gửi lời mời thất bại"); }
  };
  const acceptRequest = async (userId) => {
    const rid = statusMap[userId]?.request_id;
    if (!rid) return;
    try {
      await http.put(`/friends/requests/${rid}/accept`);
      setStatusMap((m) => ({ ...m, [userId]: { status: "friends", request_id: null } }));
      window.dispatchEvent(new CustomEvent("friends:changed"));
    } catch { alert("Chấp nhận thất bại"); }
  };
  const rejectRequest = async (userId) => {
    const rid = statusMap[userId]?.request_id;
    if (!rid) return;
    try {
      await http.put(`/friends/requests/${rid}/decline`);
      setStatusMap((m) => ({ ...m, [userId]: { status: "none", request_id: null } }));
      window.dispatchEvent(new CustomEvent("friends:changed"));
    } catch { alert("Từ chối thất bại"); }
  };

  const renderAction = (u) => {
    const st = statusMap[u.id]?.status || "none";
    if (st === "me") return <button className="btn-disabled" disabled><User size={16}/> <span>Bạn</span></button>;
    if (st === "friends") return <button className="btn-disabled" disabled>Đã là bạn bè</button>;
    if (st === "outgoing") return <button className="btn-disabled" disabled>Đã gửi lời mời</button>;
    if (st === "incoming")
      return (
        <div className="btn-row">
          <button className="btn-primary" onClick={() => acceptRequest(u.id)}><Check size={16}/><span>Chấp nhận</span></button>
          <button className="btn-ghost" onClick={() => rejectRequest(u.id)}><X size={16}/><span>Từ chối</span></button>
        </div>
      );
    return (
      <button className="btn-primary" onClick={() => sendRequest(u.id)}>
        <UserPlus size={16}/><span>Kết bạn</span>
      </button>
    );
  };

  return (
    <div className="search-page">
      <div className="search-container">
        <div className="search-bar">
          <Search className="search-icon" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSearch) doSearchNow(); }}
            placeholder="Tìm kiếm người dùng theo tên hoặc email…"
          />
          <button className="btn-primary" onClick={doSearchNow} disabled={!canSearch || loading}>Tìm</button>
        </div>

        {!loading && results.length === 0 && !canSearch && (
          <div className="empty-hint">Nhập từ khóa để bắt đầu tìm kiếm.</div>
        )}
        {loading && <div className="loading">Đang tìm…</div>}

        {!loading && results.length > 0 && (
          <>
            <div className="result-header">Kết quả <span className="muted">({results.length})</span></div>
            <div className="result-list">
              {results.map((u) => (
                <div key={u.id} className="user-card">
                  <div className="avatar" />
                  <div className="info">
                    <div className="name" onClick={() => onOpenProfile?.(u)} title="Xem trang cá nhân">{u.display_name}</div>
                    <div className="sub">{u.email}</div>
                    {u.date_of_birth && <div className="sub">Sinh: {u.date_of_birth}</div>}
                  </div>
                  <div className="actions">{renderAction(u)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && canSearch && results.length === 0 && (
          <div className="empty-hint">Không tìm thấy người dùng phù hợp.</div>
        )}
      </div>
    </div>
  );
}
