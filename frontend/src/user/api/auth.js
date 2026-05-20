// src/api/auth.js
import http from "./http";

// ---- Token utilities (Frontend storage) ---- //
export function setToken(token) {
  localStorage.setItem("token", token);
}

export function getToken() {
  return localStorage.getItem("token") || null;
}

export function clearToken() {
  localStorage.removeItem("token");
}

// ---- Auth APIs ---- //

/**
 * Đăng ký user mới
 * @param {Object} data { display_name, email, password, date_of_birth }
 */
export async function register(data) {
  const res = await http.post("/auth/register", data);
  return res.data;
}

/**
 * Đăng nhập
 * FE sẽ tự lưu token và role sau khi login thành công
 * @param {Object} data { email, password }
 */
export async function login(data) {
  const res = await http.post("/auth/login", data);

  // res.data trả về { access_token, role, is_admin, user:{} }
  if (res.data?.access_token) {
    setToken(res.data.access_token);
  }

  return res.data; // trả luôn user + role để FE redirect
}

/**
 * Lấy thông tin user hiện tại từ access token
 */
export async function me() {
  const token = getToken();
  if (!token) return null;

  const res = await http.get("/auth/me", {
    headers: { Authorization: "Bearer " + token },
  });

  return res.data;
}

/**
 * Kiểm tra quyền admin (FE sẽ redirect nếu không phải ADMIN)
 */
export function isAdmin() {
  const token = getToken();
  if (!token) return false;

  try {
    // Giải mã JWT (không cần lib decode, backend trả role xong rồi)
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role === "ADMIN";
  } catch (e) {
    return false;
  }
}

/**
 * Lấy payload từ JWT (nếu có)
 */
export function getTokenPayload() {
  const token = getToken();
  if (!token) return null;

  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch (e) {
    return null;
  }
}
