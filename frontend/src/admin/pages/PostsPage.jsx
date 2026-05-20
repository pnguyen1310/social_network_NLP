import React, { useEffect, useState } from 'react';
import DataTable from '../components/cards/DataTable';
import { admin as api } from '../api';
import { Trash2 } from 'lucide-react';
import './PostsPage.css';

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

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    loadPosts();
  }, [searchQ]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const data = await api.posts({ q: searchQ, limit: 50 });
      setPosts(data.items || []);
    } catch (e) {
      console.warn('Load posts failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xóa bài viết này?')) return;
    try {
      await api.deletePost(id);
      setPosts(posts.filter(p => p.id !== id));
    } catch (e) {
      alert('Xóa thất bại');
    }
  };

  const handleView = async (post) => {
    setSelectedPost(post);
    setDetailLoading(true);
    setDetailError('');

    try {
      const detail = await api.postDetail(post.id, { analyze_comments: true });
      setSelectedPost(detail);
    } catch (e) {
      console.warn('Load post detail failed:', e);
      setDetailError(e?.response?.data?.detail || 'Không tải được chi tiết bài viết');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="posts-page">
      <div className="page-header">
        <h2>Quản lý bài viết</h2>
        <div className="search-box">
          <input
            type="text"
            placeholder="Tìm theo nội dung..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        title={`Danh sách bài viết (${posts.length})`}
        columns={[
          { key: 'id', label: 'ID', width: '60px' },
          { key: 'content', label: 'Nội dung', render: (v, row) => {
            if (row.media_type === 'image' && row.media_url) {
              return (
                <div className="post-content-inline">
                  <img
                    className="post-content-thumb"
                    src={getMediaUrl(row.media_url)}
                    alt="Ảnh bài viết"
                  />
                  <div className="post-content-copy">
                    <div className="post-content-title">Bài đăng ảnh</div>
                    <div className="post-content-text">
                      {v ? v.slice(0, 80) + (v.length > 80 ? '…' : '') : 'Chưa có mô tả'}
                    </div>
                  </div>
                </div>
              );
            }
            if (row.media_type === 'video' && row.media_url) {
              return (
                <div className="post-content-inline">
                  <video
                    className="post-content-thumb post-content-video"
                    src={getMediaUrl(row.media_url)}
                  />
                  <div className="post-content-copy">
                    <div className="post-content-title">Bài đăng video</div>
                    <div className="post-content-text">
                      {v ? v.slice(0, 80) + (v.length > 80 ? '…' : '') : 'Video không có mô tả'}
                    </div>
                  </div>
                </div>
              );
            }
            if (v) return v.slice(0, 100) + (v.length > 100 ? '…' : '');
            if (row.media_type === 'video') return 'Bài đăng video';
            return '(không)';
          }},
          {
            key: 'author',
            label: 'Tác giả',
            render: (v, row) => (
              <div className="author-inline">
                {getAvatarUrl(row.author) ? (
                  <img
                    className="author-avatar"
                    src={getAvatarUrl(row.author)}
                    alt={getAuthorName(row.author)}
                  />
                ) : (
                  <span className="author-avatar-fallback">
                    {getAuthorName(row.author).charAt(0).toUpperCase()}
                  </span>
                )}
                <span>{getAuthorName(row.author)}</span>
              </div>
            )
          },
          { key: 'created_at', label: 'Ngày tạo', render: (v) => v ? new Date(v).toLocaleDateString() : '?' },
          {
            key: 'actions',
            label: 'Hành động',
            width: '140px',
            render: (_, row) => (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="view-detail-btn" onClick={() => handleView(row)}>
                  Xem chi tiết
                </button>
                <button 
                  className="btn-icon delete" 
                  onClick={() => handleDelete(row.id)}
                  title="Xóa"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          },
        ]}
        data={posts}
        loading={loading}
      />

      {selectedPost && (
        <div className="modal-overlay" onClick={() => setSelectedPost(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi tiết bài viết</h3>
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
                  {selectedPost.content ? selectedPost.content : (
                    selectedPost.media_type === 'video' ? '(bài đăng video)' : 
                    selectedPost.media_type === 'image' ? '(bài đăng ảnh)' : 
                    '(không có nội dung)'
                  )}
                </p>
              </div>
              {selectedPost.media_url && (
                <div className="detail-row">
                  <label>Media:</label>
                  <div className="media-preview">
                    {selectedPost.media_type === 'video' ? (
                      <video controls src={`http://localhost:8000${selectedPost.media_url}`} style={{ maxWidth: '100%', maxHeight: '300px' }} />
                    ) : (
                      <img src={`http://localhost:8000${selectedPost.media_url}`} alt="Post media" style={{ maxWidth: '100%', maxHeight: '300px' }} />
                    )}
                  </div>
                </div>
              )}
              <div className="detail-row">
                <label>Lượt thích:</label>
                <span>{selectedPost.like_count || 0}</span>
              </div>
              <div className="detail-row">
                <label>Bình luận:</label>
                <span>{selectedPost.comment_count || 0}</span>
              </div>
              <div className="detail-row detail-row-comments">
                <label>Chi tiết bình luận:</label>
                <div className="comments-panel">
                  {detailLoading ? (
                    <div className="comments-empty">Đang tải bình luận và phân tích cảm xúc...</div>
                  ) : detailError ? (
                    <div className="comments-empty comments-error">{detailError}</div>
                  ) : !selectedPost.comments?.length ? (
                    <div className="comments-empty">Chưa có bình luận nào</div>
                  ) : (
                    <div className="comment-list">
                      {selectedPost.comments.map((comment) => (
                        <div className="comment-card" key={comment.id}>
                          <div className="comment-header">
                            <div className="author-inline">
                              {getAvatarUrl(comment.author) ? (
                                <img
                                  className="author-avatar"
                                  src={getAvatarUrl(comment.author)}
                                  alt={getAuthorName(comment.author)}
                                />
                              ) : (
                                <span className="author-avatar-fallback">
                                  {getAuthorName(comment.author).charAt(0).toUpperCase()}
                                </span>
                              )}
                              <div className="comment-meta">
                                <strong>{getAuthorName(comment.author)}</strong>
                                <span>
                                  {comment.created_at ? new Date(comment.created_at).toLocaleString('vi-VN') : '?'}
                                </span>
                              </div>
                            </div>

                            <div className="comment-sentiment">
                              <span className={`label-badge ${labelClass(comment.sentiment_label)}`}>
                                {labelText(comment.sentiment_label)}
                              </span>
                              <span className="comment-score">{formatScore(comment.sentiment_score)}</span>
                            </div>
                          </div>

                          <div className="comment-content">{comment.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
