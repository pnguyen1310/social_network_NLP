import React, { useEffect, useState } from 'react';
import DataTable from '../components/cards/DataTable';
import { admin as api } from '../api';
import './SentimentPage.css';

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

function formatScore(score) {
  if (typeof score !== 'number') return '—';
  return `${(score * 100).toFixed(2)}%`;
}

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

function getAuthorName(author) {
  return author?.display_name || author?.email || '?';
}

function getAvatarUrl(author) {
  const raw = author?.avatar_url;
  if (!raw) return null;
  if (String(raw).startsWith('http://') || String(raw).startsWith('https://')) return raw;
  return `${API_BASE}${raw}`;
}

function getMediaUrl(raw) {
  if (!raw) return null;
  if (String(raw).startsWith('http://') || String(raw).startsWith('https://')) return raw;
  return `${API_BASE}${raw}`;
}

export default function SentimentPage() {
  const [items, setItems] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [summary, setSummary] = useState({ total_posts: 0, total_analyzed: 0, total_cached: 0, label_counts: {} });

  useEffect(() => {
    loadItems();
  }, [searchQ]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await api.sentimentPosts({ q: searchQ, limit: 50 });
      setItems(data.items || []);
      setSummary(data.summary || { total_posts: 0, total_analyzed: 0, total_cached: 0, label_counts: {} });
    } catch (e) {
      console.warn('Load sentiment posts failed:', e);
      setSummary({ total_posts: 0, total_analyzed: 0, total_cached: 0, label_counts: {} });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sentiment-page">
      <div className="page-header">
        <h2>Phân tích cảm xúc bài viết</h2>
        <div className="search-box">
          <input
            type="text"
            placeholder="Tìm theo nội dung..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
      </div>

      <div className="sentiment-summary">
        <span className="summary-pill">Bài viết tải về: {summary.total_posts || 0}</span>
        <span className="summary-pill">Đã phân tích: {summary.total_analyzed || 0}</span>
        <span className="summary-pill">Lấy từ cache: {summary.total_cached || 0}</span>
        {Object.entries(summary.label_counts || {}).map(([label, count]) => (
          <span key={label} className={`summary-pill ${labelClass(label)}`}>
            {labelText(label)}: {count}
          </span>
        ))}
      </div>

      <DataTable
        title={`Kết quả phân tích (${items.length})`}
        columns={[
          { key: 'id', label: 'ID', width: '60px' },
          {
            key: 'content',
            label: 'Nội dung',
            render: (v, row) => {
              if ((row.media_type === 'image' || row.media_type === 'video') && row.media_url) {
                const src = getMediaUrl(row.media_url);
                const isVideo = row.media_type === 'video';
                const title = isVideo ? 'Bài đăng video' : 'Bài đăng ảnh';
                const fallbackText = isVideo
                  ? 'Video không có mô tả văn bản'
                  : 'Ảnh không có mô tả văn bản';
                return (
                  <div className="content-cell-inline">
                    {isVideo ? (
                      <video
                        className="content-media-thumb content-video-thumb"
                        src={src}
                        muted
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <img className="content-media-thumb" src={src} alt="Ảnh bài viết" />
                    )}
                    <div className="content-copy">
                      <div className="content-title">{title}</div>
                      <div className="content-caption">
                        {v ? v.slice(0, 80) + (v.length > 80 ? '…' : '') : fallbackText}
                      </div>
                    </div>
                  </div>
                );
              }
              if (v) return v.slice(0, 100) + (v.length > 100 ? '…' : '');
              if (row.media_type === 'video') return 'Bài đăng video';
              return '(không có nội dung)';
            }
          },
          { key: 'author', label: 'Tác giả', render: (v, row) => row.author?.display_name || '?' },
          {
            key: 'sentiment_label',
            label: 'Nhãn',
            width: '120px',
            render: (v) => (
              <span className={`label-badge ${labelClass(v)}`}>
                {labelText(v)}
              </span>
            )
          },
          {
            key: 'sentiment_score',
            label: 'Độ tin cậy',
            width: '140px',
            render: (v) => formatScore(v)
          },
          {
            key: 'detail',
            label: 'Hành động',
            width: '130px',
            render: (_, row) => (
              <button className="view-detail-btn" onClick={() => setSelectedPost(row)}>
                Xem chi tiết
              </button>
            )
          },
        ]}
        data={items}
        loading={loading}
        empty="Chưa có dữ liệu"
      />

      {selectedPost && (
        <div className="modal-overlay" onClick={() => setSelectedPost(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi tiết phân tích</h3>
              <button className="close-btn" onClick={() => setSelectedPost(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <label>ID:</label>
                <span>{selectedPost.id}</span>
              </div>
              <div className="detail-row">
                <label>Tác giả:</label>
                <div className="author-inline">
                  {getAvatarUrl(selectedPost.author) ? (
                    <img
                      className="author-avatar"
                      src={getAvatarUrl(selectedPost.author)}
                      alt={getAuthorName(selectedPost.author)}
                    />
                  ) : (
                    <span className="author-avatar-fallback">
                      {getAuthorName(selectedPost.author).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span>{getAuthorName(selectedPost.author)}</span>
                </div>
              </div>
              <div className="detail-row">
                <label>Nội dung:</label>
                <p className="content-text">
                  {selectedPost.content ? selectedPost.content : '(không có nội dung)'}
                </p>
              </div>
              {selectedPost.media_url && (
                <div className="detail-row detail-row-media">
                  <label>Media:</label>
                  <div className="detail-media-box">
                    {selectedPost.media_type === 'video' ? (
                      <video
                        className="detail-media-video"
                        controls
                        src={getMediaUrl(selectedPost.media_url)}
                      />
                    ) : (
                      <img
                        className="detail-media-image"
                        src={getMediaUrl(selectedPost.media_url)}
                        alt="Ảnh bài viết"
                      />
                    )}
                  </div>
                </div>
              )}
              <div className="detail-row">
                <label>Nhãn cảm xúc:</label>
                <span className={`label-badge ${labelClass(selectedPost.sentiment_label)}`}>
                  {labelText(selectedPost.sentiment_label)}
                </span>
              </div>
              <div className="detail-row">
                <label>Độ tin cậy:</label>
                <span>{formatScore(selectedPost.sentiment_score)}</span>
              </div>
              <div className="detail-row">
                <label>Ngày tạo:</label>
                <span>{selectedPost.created_at ? new Date(selectedPost.created_at).toLocaleString() : '?'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
