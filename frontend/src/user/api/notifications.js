const API = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export async function listNotifications(token, { page = 1, limit = 50, unread_only = true } = {}) {
  const url = new URL(`${API}/notifications`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("unread_only", String(!!unread_only));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function unreadCount(token, { limit = 200 } = {}) {
  const data = await listNotifications(token, { page: 1, limit, unread_only: true });
  const items = Array.isArray(data?.items) ? data.items : [];
  return { count: items.length };
}

export async function markRead(token, ids) {
  const idList = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : []);
  if (idList.length === 0) {
    const res = await fetch(`${API}/notifications/mark_all_read`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to mark all read");
    return;
  }

  if (idList.length === 1) {
    const res = await fetch(`${API}/notifications/${idList[0]}/read`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to mark one read");
    return;
  }

  await Promise.all(
    idList.map((id) =>
      fetch(`${API}/notifications/${id}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      })
    )
  );
}
