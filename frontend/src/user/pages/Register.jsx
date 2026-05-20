import React, { useEffect, useState, useRef } from "react";
import { register as apiRegister } from "../api/auth";
import http from "../api/http";
import "./login.css";
import bg from "../../assets/login_wallpaper.jpg";

export default function Register({ onDone, imageUrl }) {
  // --- Step state ---
  const [step, setStep] = useState(1); // 1: info, 2: password, 3: avatar

  // --- Form fields ---
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState(""); // YYYY-MM-DD
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // --- Avatar state ---
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const fileInputRef = useRef(null);

  // --- UI state ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    document.body.classList.add("auth-page");
    return () => {
      document.body.classList.remove("auth-page");
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  // --- Helpers ---
  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const calcAge = (iso) => {
    if (!iso) return 0;
    const b = new Date(iso);
    const t = new Date();
    let age = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
    return age;
  };

  const normalizeErrorMessage = (err, fallback) => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") {
        return first.msg || first.message || fallback;
      }
    }
    if (detail && typeof detail === "object") {
      return detail.msg || detail.message || fallback;
    }
    if (typeof err?.message === "string" && err.message.trim()) return err.message;
    return fallback;
  };

  // --- Step 1 → Step 2 ---
  const goNext = () => {
    setError("");
    if (!displayName.trim()) return setError("Vui lòng nhập tên hiển thị.");
    if (!isValidEmail(email)) return setError("E-mail không hợp lệ.");
    if (!dob) return setError("Vui lòng chọn ngày sinh.");
    const age = calcAge(dob);
    if (age < 13) return setError("Bạn cần đủ 13 tuổi để đăng ký.");
    setStep(2);
  };

  // --- Submit (Step 2) ---
  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");
    setSuccess("");
    if (!password || password.length < 6)
      return setError("Mật khẩu phải từ 6 ký tự.");
    if (password !== confirm)
      return setError("Mật khẩu nhập lại không khớp.");

    // Bước 2 chỉ validate, CHƯA tạo tài khoản.
    // Tài khoản chỉ được tạo ở bước 3 khi người dùng Skip hoặc Confirm avatar.
    setStep(3);
  };

  // --- Avatar handlers ---
  const onAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setError("Vui lòng chọn ảnh JPG, PNG, GIF hoặc WebP.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Ảnh quá lớn (tối đa 5MB).");
      return;
    }

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError("");
    setSuccess("");
  };

  const finalizeRegistration = async (withAvatar = false) => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await apiRegister({
        display_name: displayName.trim(),
        email: email.trim(),
        password,
        date_of_birth: dob,
      });

      // Đăng nhập để lấy token cho upload avatar (nếu có)
      const loginRes = await http.post("/auth/login", {
        email: email.trim(),
        password,
      });

      const newToken = loginRes?.data?.access_token;
      if (!newToken) {
        throw new Error("Không lấy được token sau khi đăng ký");
      }

      if (withAvatar && avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        await http.post("/users/me/avatar", formData, {
          headers: { Authorization: `Bearer ${newToken}` },
        });
        setSuccess("Đăng ký thành công và đã cập nhật avatar!");
      } else {
        setSuccess("Đăng ký thành công!");
      }

      setTimeout(() => onDone?.(), 900);
    } catch (err) {
      setError(normalizeErrorMessage(err, "Đăng ký thất bại. Vui lòng thử lại."));
    } finally {
      setLoading(false);
    }
  };

  const skipAvatar = async () => {
    await finalizeRegistration(false);
  };

  const uploadAvatar = async () => {
    if (!avatarFile) {
      setError("Vui lòng chọn ảnh avatar hoặc nhấn Skip.");
      return;
    }
    await finalizeRegistration(true);
  };

  // --- Enter key ---
  const onEnter = (e) => {
    if (e.key === "Enter") {
      if (step === 1) goNext();
      else if (step === 2) submit(e);
      else if (step === 3 && avatarFile) uploadAvatar();
    }
  };

  return (
    <div className="auth-wrap reverse">
      {/* Ảnh nền bên phải */}
      <div
        className="auth-left"
        style={{
          backgroundImage: `url(${imageUrl || bg || "/login-bg.jpg"})`,
        }}
        aria-hidden
      />

      {/* Form bên trái */}
      <div className="auth-right">
        <div className="auth-card">
          {/* Stepper mini */}
          <div className="stepper">
            <div className={`step-dot ${step >= 1 ? "active" : ""}`} />
            <div className={`step-line ${step >= 2 ? "active" : ""}`} />
            <div className={`step-dot ${step >= 2 ? "active" : ""}`} />
            <div className={`step-line ${step >= 3 ? "active" : ""}`} />
            <div className={`step-dot ${step >= 3 ? "active" : ""}`} />
          </div>

          <h1 className="auth-title">
            {step === 1 ? "Sign Up" : step === 2 ? "Create password" : "Set avatar"}
          </h1>
          <p className="auth-subtitle">
            {step === 1
              ? "Tell us a bit about you."
              : step === 2
              ? "Secure your account with a password."
              : "Choose a profile picture (optional)"}
          </p>

          <div className="step-wrap" onKeyDown={onEnter}>
            {/* STEP 1: Basic info */}
            <form
              className={`step-pane ${step === 1 ? "active" : ""}`}
              onSubmit={(e) => {
                e.preventDefault();
                goNext();
              }}
            >
              <label className="auth-label">Your name *</label>
              <input
                className="auth-input"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />

              <label className="auth-label">E-mail *</label>
              <input
                className="auth-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />

              <label className="auth-label">Date of Birth *</label>
              <input
                className="auth-input"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                max={new Date().toISOString().split("T")[0]} // ✅ Không cho chọn ngày tương lai
              />

              {error && <div className="auth-error">{error}</div>}

              <div className="step-actions">
                <button type="button" className="auth-btn" onClick={goNext}>
                  Continue
                </button>
              </div>
            </form>

            {/* STEP 2: Password */}
            <form
              className={`step-pane ${step === 2 ? "active" : ""}`}
              onSubmit={submit}
            >
              <label className="auth-label">Password *</label>
              <input
                className="auth-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
              />

              <label className="auth-label">Confirm Password *</label>
              <input
                className="auth-input"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />

              {error && <div className="auth-error">{error}</div>}
              {success && <div className="auth-success">{success}</div>}

              <div className="step-actions two">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setError("");
                    setStep(1);
                  }}
                  disabled={loading}
                >
                  ← Back
                </button>
                <button className="auth-btn" type="submit" disabled={loading}>
                  Continue
                </button>
              </div>
            </form>

            {/* STEP 3: Avatar */}
            <form
              className={`step-pane ${step === 3 ? "active" : ""}`}
              onSubmit={(e) => {
                e.preventDefault();
                uploadAvatar();
              }}
            >
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                {avatarPreview ? (
                  <div style={{ marginBottom: "16px" }}>
                    <img
                      src={avatarPreview}
                      alt="Preview"
                      style={{
                        width: "100px",
                        height: "100px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "3px solid #667eea",
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100px",
                      height: "100px",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #667eea, #764ba2)",
                      margin: "0 auto 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: "40px",
                      fontWeight: "bold",
                    }}
                  >
                    ?
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onAvatarChange}
                style={{ display: "none" }}
              />

              {error && <div className="auth-error">{error}</div>}
              {success && <div className="auth-success">{success}</div>}

              {!avatarFile ? (
                <div className="step-actions two">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={skipAvatar}
                    disabled={loading}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    className="auth-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                  >
                    Choose image
                  </button>
                </div>
              ) : (
                <div className="step-actions two">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                  >
                    Choose another
                  </button>
                  <button
                    type="submit"
                    className="auth-btn"
                    disabled={loading}
                  >
                    {loading ? "Uploading…" : "Confirm"}
                  </button>
                </div>
              )}
            </form>
          </div>

          <div className="auth-bottom">
            Already have an account?{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => onDone?.()}
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
