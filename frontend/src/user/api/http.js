// src/api/http.js
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

const http = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
  timeout: 120000,
  headers: {
    Accept: "application/json",
  },
});

// ===== Request interceptor =====
http.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  console.log(`[HTTP] ${method.toUpperCase()} ${config.url}`);
  
  // Gắn Bearer token nếu có
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  // Không ép Content-Type nếu đã set tay
  const hasCT =
    (config.headers &&
      (config.headers["Content-Type"] || config.headers["content-type"])) ||
    false;

  if (!hasCT) {
    const isFormData =
      typeof FormData !== "undefined" && config.data instanceof FormData;
    const isFile =
      (typeof File !== "undefined" && config.data instanceof File) ||
      (typeof Blob !== "undefined" && config.data instanceof Blob);

    // Chỉ set JSON cho request có body và không phải form/file
    const methodHasBody = ["post", "put", "patch"].includes(method);
    if (methodHasBody && !isFormData && !isFile) {
      config.headers["Content-Type"] = "application/json";
    }
  }

  return config;
});

// ===== Response interceptor =====
http.interceptors.response.use(
  (res) => res,
  (error) => {
    // Phát sự kiện 401 để App xử lý chung (logout/refresh UI)
    if (error?.response?.status === 401) {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    return Promise.reject(error);
  }
);

console.log("[HTTP] Using baseURL:", API_BASE);
export default http;
