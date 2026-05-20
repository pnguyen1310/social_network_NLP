import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { admin } from '../api';
import './ToxicLanguagePage.css';

const DEFAULT_MIN_SCORE = 0.55;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedContent(content, terms) {
  const value = String(content || '');
  const safeTerms = Array.isArray(terms)
    ? terms.map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  if (!value || safeTerms.length === 0) {
    return value;
  }

  const uniqueTerms = [...new Set(safeTerms)].sort((a, b) => b.length - a.length);
  const pattern = uniqueTerms.map((t) => escapeRegExp(t)).join('|');
  if (!pattern) {
    return value;
  }

  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = value.split(regex);

  return parts.map((part, idx) => {
    const matched = uniqueTerms.some((term) => term.toLowerCase() === part.toLowerCase());
    if (!matched) {
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    }
    return (
      <mark key={idx} className="toxic-word">
        {part}
      </mark>
    );
  });
}

export default function ToxicLanguagePage() {
  const [loading, setLoading] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);

  const summary = useMemo(() => {
    const total = rows.length;
    const flagged = rows.filter((r) => r.flagged).length;
    const avgScore = rows.length
      ? rows.reduce((sum, row) => {
          const score = row?.toxic_analysis?.toxic_score;
          return sum + (typeof score === 'number' ? score : 0);
        }, 0) / rows.length
      : 0;
    const matchedTerms = rows.reduce((count, row) => {
      const terms = row?.toxic_analysis?.matched_terms;
      return count + (Array.isArray(terms) ? terms.length : 0);
    }, 0);
    return { total, flagged, avgScore, matchedTerms };
  }, [rows]);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await admin.toxicLanguagePosts({
        limit: 50,
        offset: 0,
        flagged_only: true,
        min_score: DEFAULT_MIN_SCORE,
      });
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Không thể quét dữ liệu độc hại');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runScan();
  }, [runScan]);

  async function handleDeletePost(postId) {
    const ok = window.confirm('Bạn có chắc muốn xóa bài viết này không?');
    if (!ok) {
      return;
    }

    setDeletingPostId(postId);
    setError('');
    try {
      await admin.deletePost(postId);
      await runScan();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Không thể xóa bài viết');
    } finally {
      setDeletingPostId(null);
    }
  }

  return (
    <section className="toxic-page">
      <div className="toxic-page__card">
        <div className="toxic-page__hero">
          <div>
            <p className="toxic-page__eyebrow">Giám sát nội dung</p>
            <h2 className="toxic-page__title">Phát hiện ngôn ngữ độc hại (Tiếng Việt)</h2>
            <p className="toxic-page__desc">
              Hệ thống tự động quét bài mới lúc tạo. Bảng dưới đây chỉ hiển thị bài viết bị gắn cờ.
            </p>
          </div>

          <div className="toxic-page__actions">
          </div>
        </div>

        <div className="toxic-page__stats">
          <article>
            <strong>{summary.flagged}</strong>
            <span>Bài bị gắn cờ</span>
          </article>
          <article>
            <strong>{summary.avgScore.toFixed(2)}</strong>
            <span>Điểm trung bình</span>
          </article>
          <article>
            <strong>{summary.matchedTerms}</strong>
            <span>Từ khớp</span>
          </article>
        </div>

        {error ? <p className="toxic-page__error">{error}</p> : null}

        <div className="toxic-page__table-wrap">
          {rows.length === 0 && !loading ? (
            <div className="toxic-page__empty-state">
              <div className="toxic-page__empty-icon">✓</div>
              <h3>Chưa có nội dung vi phạm</h3>
              <p>Không có bài bị gắn cờ ở ngưỡng hiện tại. Hãy thử đăng một bài có ngôn ngữ bậy để kiểm tra.</p>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <table className="toxic-table">
              <thead>
                <tr>
                  <th>Post ID</th>
                  <th>Tác giả</th>
                  <th>Nội dung</th>
                  <th>Điểm</th>
                  <th>Mức độ</th>
                  <th>Từ đánh dấu</th>
                  <th>Lý do</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const analysis = row.toxic_analysis || {};
                  const score = typeof analysis.toxic_score === 'number' ? analysis.toxic_score.toFixed(2) : 'N/A';
                  const matchedTerms = Array.isArray(analysis.matched_terms) ? analysis.matched_terms : [];
                  return (
                    <tr key={row.post_id}>
                      <td className="toxic-table__id">#{row.post_id}</td>
                      <td>
                        <div className="toxic-table__author">
                          <span className="toxic-table__author-name">
                            {row.author?.display_name || row.author?.email || `Người dùng ${row.author?.id || ''}`}
                          </span>
                          <span className="toxic-table__author-meta">{row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-'}</span>
                        </div>
                      </td>
                      <td className="toxic-table__content">{renderHighlightedContent(row.content, matchedTerms)}</td>
                      <td>
                        <span className="toxic-table__score">{score}</span>
                      </td>
                      <td>
                        <span className={`toxic-table__severity severity-${String(analysis.severity || 'low').toLowerCase()}`}>
                          {analysis.severity || 'N/A'}
                        </span>
                      </td>
                      <td className="toxic-table__terms">{matchedTerms.join(', ') || '-'}</td>
                      <td className="toxic-table__reason">{analysis.reason || '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="toxic-table__delete-btn"
                          onClick={() => handleDeletePost(row.post_id)}
                          disabled={deletingPostId === row.post_id}
                        >
                          {deletingPostId === row.post_id ? 'Đang xóa...' : 'Xóa'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </section>
  );
}
