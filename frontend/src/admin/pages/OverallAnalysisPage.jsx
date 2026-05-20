import React, { useEffect, useState } from 'react';
import DataTable from '../components/cards/DataTable';
import { admin as api } from '../api';
import './OverallAnalysisPage.css';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000';

const LABEL_TEXT = {
  NEG: 'Tiêu cực',
  NEGATIVE: 'Tiêu cực',
  POS: 'Tích cực',
  POSITIVE: 'Tích cực',
  NEU: 'Trung tính',
  NEUTRAL: 'Trung tính',
  ANGER: 'Giận dữ',
  DISGUST: 'Khó chịu',
  ENJOYMENT: 'Vui vẻ',
  FEAR: 'Lo sợ',
  OTHER: 'Khác',
  SADNESS: 'Buồn bã',
  SURPRISE: 'Bất ngờ',
};

function labelClass(label) {
  const key = String(label || '').trim().toUpperCase();
  if (['POS', 'POSITIVE', 'ENJOYMENT'].includes(key)) return 'label-pos';
  if (['NEU', 'NEUTRAL', 'OTHER', 'SURPRISE'].includes(key)) return 'label-neu';
  if (['NEG', 'NEGATIVE', 'ANGER', 'DISGUST', 'FEAR', 'SADNESS'].includes(key)) return 'label-neg';
  return 'label-na';
}

function labelText(label) {
  if (!label) return 'N/A';
  const key = String(label).trim().toUpperCase();
  return LABEL_TEXT[key] || String(label);
}

function formatScore(score) {
  if (typeof score !== 'number') return '—';
  return `${(score * 100).toFixed(2)}%`;
}

function getMediaUrl(raw) {
  if (!raw) return null;
  if (String(raw).startsWith('http://') || String(raw).startsWith('https://')) return raw;
  return `${API_BASE}${raw}`;
}

export default function OverallAnalysisPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ total_posts: 0, total_analyzed: 0, pending_count: 0, label_counts: {} });
  const [selected, setSelected] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadItems(false);
  }, []);

  useEffect(() => {
    if ((summary.pending_count || 0) <= 0) return undefined;
    const timer = setTimeout(() => {
      loadItems(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [summary.pending_count]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await api.overallPosts({ limit: 20, refresh: false, background: true });
      setItems(data.items || []);
      setSummary(data.summary || { total_posts: 0, total_analyzed: 0, pending_count: 0, label_counts: {} });
      setErrorMessage('');
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.response?.data?.message || e?.response?.data;
      console.warn('Load overall analysis failed:', {
        message: e?.message,
        status,
        data: e?.response?.data,
      });
      setErrorMessage(
        [status ? `HTTP ${status}` : null, detail ? String(detail) : null].filter(Boolean).join(' - ')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overall-page">
      <div className="page-header">
        <h2>Phân tích chung (Tất cả bài viết)</h2>
      </div>

      <div className="overall-summary">
        <span className="summary-pill">Tổng bài viết: {summary.total_posts || 0}</span>
        <span className="summary-pill">Đang phân tích nền: {summary.pending_count || 0}</span>
        {Object.entries(summary.label_counts || {}).map(([label, count]) => (
          <span key={label} className={`summary-pill ${labelClass(label)}`}>
            {labelText(label)}: {count}
          </span>
        ))}
      </div>

      {summary.pending_count > 0 && !errorMessage && (
        <div className="error-banner">Đang hiển thị cache trước, bài chưa cache đang được phân tích nền.</div>
      )}

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <DataTable
        title={`Kết quả phân tích chung (${items.length})`}
        columns={[
          { key: 'id', label: 'ID', width: '60px' },
          {
            key: 'media_url',
            label: 'Media',
            width: '160px',
            render: (v, row) => {
              const src = getMediaUrl(v);
              if (!src) return <span className="media-empty-pill">Text only</span>;
              if (row.media_type === 'video') {
                return <video className="overall-thumb" src={src} muted />;
              }
              return <img className="overall-thumb" src={src} alt="Media" />;
            },
          },
          {
            key: 'content',
            label: 'Caption',
            width: '260px',
            render: (v, row) => {
              if (v) return `${v.slice(0, 70)}${v.length > 70 ? '…' : ''}`;
              if (row.media_url) return <span className="media-empty-pill media-only-pill">Media only</span>;
              return '(không có caption)';
            },
          },
          {
            key: 'media_analysis',
            label: 'Mô tả media (Groq)',
            width: '260px',
            render: (_, row) => {
              if (row.media_analysis_error) return row.media_analysis_error;
              const desc = row.media_analysis?.description;
              if (!desc) return 'Chưa có mô tả media';
              return `${desc.slice(0, 80)}${desc.length > 80 ? '…' : ''}`;
            },
          },
          {
            key: 'overall_sentiment_label',
            label: 'Đánh giá chung',
            width: '190px',
            render: (v, row) => (
              <div className="overall-label-cell">
                <span className={`label-badge ${labelClass(v)}`}>{labelText(v)}</span>
                {row.is_groq_media_only && <span className="marker-pill">Không caption</span>}
                {row.overall_analysis_state === 'pending' && <span className="marker-pill marker-pending">Đang xử lý</span>}
              </div>
            ),
          },
          {
            key: 'detail',
            label: 'Chi tiết',
            width: '120px',
            render: (_, row) => (
              <button className="view-detail-btn" onClick={() => setSelected(row)}>
                Xem
              </button>
            ),
          },
        ]}
        data={items}
        loading={loading}
        empty="Chưa có dữ liệu"
      />

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi tiết phân tích chung</h3>
              <button className="close-btn" onClick={() => setSelected(null)}>x</button>
            </div>
            <div className="modal-body">
              <div className="detail-row"><label>Post ID:</label><span>{selected.id}</span></div>
              <div className="detail-row"><label>Tác giả:</label><span>{selected.author?.display_name || selected.author?.email || '?'}</span></div>
              <div className="detail-row"><label>Caption:</label><p className="content-text">{selected.content || '(không có caption)'}</p></div>
              {selected.media_url && (
                <div className="detail-row detail-row-media">
                  <label>Media:</label>
                  <div className="detail-media-box">
                    {selected.media_type === 'video' ? (
                      <video className="detail-media-video" controls src={getMediaUrl(selected.media_url)} />
                    ) : (
                      <img className="detail-media-image" src={getMediaUrl(selected.media_url)} alt="Media" />
                    )}
                  </div>
                </div>
              )}
              <div className="detail-row">
                <label>Mô tả media (Groq):</label>
                <p className="content-text">
                  {selected.media_analysis?.description || selected.media_analysis_error || 'Chưa có mô tả media'}
                </p>
              </div>
              <div className="detail-row">
                <label>Caption đưa vào model local:</label>
                <p className="content-text">{selected.model_input_text || '(không có caption để đánh giá bởi model local)'}</p>
              </div>
              <div className="detail-row">
                <label>Ngữ cảnh hợp nhất (caption + media):</label>
                <div className="fusion-context-grid">
                  <div className="fusion-context-card">
                    <div className="fusion-context-title">Caption context</div>
                    <p className="content-text">
                      {selected.model_input_text || '(không có caption)'}
                    </p>
                  </div>
                  <div className="fusion-context-card">
                    <div className="fusion-context-title">Media context (Groq)</div>
                    <p className="content-text">
                      {selected.media_analysis?.description || selected.media_analysis_error || '(chưa có mô tả media)'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="detail-row">
                <label>Cảm xúc tổng hợp:</label>
                <div className="overall-label-cell">
                  <span className={`label-badge ${labelClass(selected.overall_sentiment_label)}`}>
                    {labelText(selected.overall_sentiment_label)}
                  </span>
                  {selected.is_groq_media_only && <span className="marker-pill">Không caption</span>}
                  {selected.overall_analysis_state === 'pending' && <span className="marker-pill marker-pending">Đang xử lý</span>}
                </div>
              </div>
              {selected.overall_warning && (
                <div className="detail-row">
                  <label>Lưu ý:</label>
                  <div className="warning-box">{selected.overall_warning}</div>
                </div>
              )}
              {selected.overall_error_code && (
                <div className="detail-row">
                  <label>Mã lỗi Groq:</label>
                  <div className="error-code-box">{selected.overall_error_code}</div>
                </div>
              )}
              <div className="detail-row"><label>Độ tin cậy:</label><span>{formatScore(selected.overall_sentiment_score)}</span></div>
              <div className="detail-row"><label>Ngày tạo:</label><span>{selected.created_at ? new Date(selected.created_at).toLocaleString('vi-VN') : '?'}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
