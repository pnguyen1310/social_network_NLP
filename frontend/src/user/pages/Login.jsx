import React, { useState } from "react";
import { login, me } from "../api/auth";
import "./login.css";
import bg from "../../assets/login_wallpaper.jpg"; // ảnh cục bộ

export default function Login({ onSuccess, onForgot, onSignUp, imageUrl }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e?.preventDefault?.();
    if (loading) return;

    const emailTrim = email.trim();
    if (!emailTrim || !password) {
      setError("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Gọi login → api/auth.js sẽ tự set localStorage token
      const data = await login({ email: emailTrim, password });

      // Lấy hồ sơ hiện tại từ token đang lưu
      const profile = await me();

      // Lưu token và thông tin người dùng vào localStorage
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("me", JSON.stringify(profile));

      // Cho parent biết để điều hướng (có cả role/is_admin để đi /admin)
      onSuccess?.(data.access_token, profile, data);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Đăng nhập thất bại. Vui lòng thử lại.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Reset lỗi khi người dùng sửa input
  const onChangeEmail = (e) => {
    setEmail(e.target.value);
    if (error) setError("");
  };
  const onChangePassword = (e) => {
    setPassword(e.target.value);
    if (error) setError("");
  };

  return (
    <div className="auth-wrap">
      {/* Cột ảnh bên trái */}
      <div
        className="auth-left"
        style={{
          backgroundImage: `url(${imageUrl || bg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        aria-hidden
      />

      {/* Cột form bên phải */}
      <div className="auth-right">
        <div className="auth-card">
          <h1 className="auth-title">Sign in</h1>

          <form onSubmit={submit} className="auth-form" noValidate>
            <label className="auth-label" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={onChangeEmail}
              autoComplete="email"
              autoFocus
              required
              disabled={loading}
            />

            <label className="auth-label" htmlFor="password">
              Password
            </label>
            <div className="auth-input-wrap">
              <input
                id="password"
                className="auth-input no-mb"
                type={showPwd ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={onChangePassword}
                autoComplete="current-password"
                required
                disabled={loading}
              />

              {/* Toggle show/hide password */}
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPwd((v) => !v)}
                aria-pressed={showPwd}
                aria-label={showPwd ? "Hide password" : "Show password"}
                title={showPwd ? "Hide password" : "Show password"}
                disabled={loading}
              >
                {showPwd ? (
                  // 👁 Eye Open
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient id="eyeGrad" x1="0" y1="0" x2="24" y2="24">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="50%" stopColor="#2563eb" />
                        <stop offset="100%" stopColor="#9333ea" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M2 12C4.5 7 8.5 4 12 4c3.5 0 7.5 3 10 8-2.5 5-6.5 8-10 8s-7.5-3-10-8Z"
                      stroke="url(#eyeGrad)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" fill="url(#eyeGrad)" />
                  </svg>
                ) : (
                  // 🙈 Eye Closed (slash)
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient id="slashGrad" x1="0" y1="0" x2="24" y2="24">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="50%" stopColor="#2563eb" />
                        <stop offset="100%" stopColor="#9333ea" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M3 3l18 18M2 12c2-5 7-9 11-9 1.5 0 3 .3 4.3.9M22 12c-2 5-7 9-11 9-1.6 0-3.1-.3-4.4-.9"
                      stroke="url(#slashGrad)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>

            <div className="auth-row">
              <span />
              <button
                type="button"
                className="auth-link"
                onClick={() => onForgot?.()}
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button
              className="auth-btn"
              type="submit"
              disabled={!email.trim() || !password || loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="auth-bottom">
            Don’t have an account?{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => onSignUp?.()}
              disabled={loading}
            >
              Sign Up!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
