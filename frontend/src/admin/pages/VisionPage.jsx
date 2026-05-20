import React, { useEffect, useState } from 'react';
import DataTable from '../components/cards/DataTable';
import { admin as api } from '../api';
import './VisionPage.css';

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000';

function getMediaUrl(raw) {
  if (!raw) return null;
  if (String(raw).startsWith('http://') || String(raw).startsWith('https://')) return raw;
  return `${API_BASE}${raw}`;
}

function renderAnalysisText(row) {
  if (row.analysis_error) {
    return (
      <div className="analysis-cell">
        <div className="analysis-main analysis-error-inline">{row.analysis_error}</div>
      </div>
    );
  }

  const analysis = row.analysis;
  if (!analysis) {
    return (
      <div className="analysis-cell">
        <div className="analysis-main analysis-muted">Đang phân tích...</div>
      </div>
    );
  }

  return (
    <div className="analysis-cell">
      {analysis.description ? (
        <div className="analysis-caption">{analysis.description}</div>
      ) : null}
      {analysis.description_error ? (
        <div className="analysis-caption analysis-caption-error">
          Mô tả ảnh: {analysis.description_error}
        </div>
      ) : null}
      {!analysis.description && !analysis.description_error ? (
        <div className="analysis-main analysis-muted">Chưa có mô tả</div>
      ) : null}
    </div>
  );
}

export default function VisionPage() {
  const [items, setItems] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [detailAnalysis, setDetailAnalysis] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [contentExpanded, setContentExpanded] = useState(false);

  useEffect(() => {
    loadItems();
  }, [searchQ]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await api.visionPosts({
        q: searchQ,
        limit: 20,
        analyze: true,
        describe: true,
      });
      setItems(data.items || []);
    } catch (e) {
      console.warn('Load vision posts failed:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (row) => {
    setSelectedPost(row);
    setDetailAnalysis(null);
    setDetailError('');
    setDetailLoading(true);
    setContentExpanded(false);

    try {
      const [postDetail, analyze] = await Promise.all([
        api.postDetail(row.id),
        api.analyzePostImage(row.id, {
          describe: true,
        }),
      ]);

      setSelectedPost({
        ...row,
        ...postDetail,
        author: postDetail?.author || row.author,
      });
      setDetailAnalysis(analyze?.analysis || null);
    } catch (e) {
      console.warn('Load vision detail failed:', e);
      setDetailError(e?.response?.data?.detail || 'Không tải được chi tiết phân tích media');
      setDetailAnalysis(row.analysis || null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedPost(null);
    setDetailAnalysis(null);
    setDetailError('');
    setDetailLoading(false);
    setContentExpanded(false);
  };

  const activeAnalysis = detailAnalysis || selectedPost?.analysis || null;
  const hasLongContent = Boolean(selectedPost?.content && selectedPost.content.length > 320);
  const selectedMediaUrl = getMediaUrl(selectedPost?.media_url);
  const isSelectedVideo = selectedPost?.media_type === 'video';

  return (
    <div className="vision-page">
      <div className="page-header">
        <h2>Phân tích media</h2>
        <div className="search-box">
          <input
            type="text"
            placeholder="Tìm bài có media..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        title={`Danh sách bài viết có media (${items.length})`}
        columns={[
          { key: 'id', label: 'ID', width: '60px' },
          {
            key: 'media_url',
            label: 'Media',
            width: '140px',
            render: (v, row) => {
              const src = getMediaUrl(v);
              if (!src) return '(không media)';
              if (row.media_type === 'video') {
                return (
                  <video className="preview-thumb" src={src} muted />
                );
              }
              return <img className="preview-thumb" src={src} alt="Media xem trước" />;
            },
          },
          {
            key: 'content',
            label: 'Nội dung phân tích',
            render: (_, row) => renderAnalysisText(row),
          },
          {
            key: 'author',
            label: 'Tác giả',
            render: (_, row) => row.author?.display_name || row.author?.email || '?',
          },
          {
            key: 'created_at',
            label: 'Ngày tạo',
            width: '120px',
            render: (v) => (v ? new Date(v).toLocaleDateString('vi-VN') : '?'),
          },
          {
            key: 'detail',
            label: 'Chi tiết',
            width: '130px',
            render: (_, row) => (
              <button
                type="button"
                className="view-detail-btn"
                onClick={() => openDetail(row)}
              >
                Xem chi tiết
              </button>
            ),
          },
        ]}
        data={items}
        loading={loading}
        empty="Chưa có bài viết media"
      />

      {selectedPost && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi tiết bài đăng và phân tích</h3>
              <button className="close-btn" onClick={closeDetail}>×</button>
            </div>

            <div className="vision-body">
              <div className="image-wrap">
                {selectedMediaUrl ? (
                  isSelectedVideo ? (
                    <video className="preview-image" src={selectedMediaUrl} controls preload="metadata" />
                  ) : (
                    <img
                      className="preview-image"
                      src={selectedMediaUrl}
                      alt="Ảnh bài đăng"
                    />
                  )
                ) : (
                  <div className="no-image">Bài viết không có media</div>
                )}
              </div>

              <div className="analysis-panel">
                {detailLoading && <div className="muted">Đang tải phân tích chi tiết...</div>}
                {detailError && !detailLoading && (
                  <div className="analysis-error">{detailError}</div>
                )}

                {!detailLoading && (
                  <>
                    <div className="detail-stats-grid">
                      <div className="detail-stat">
                        <span>Post ID</span>
                        <strong>{selectedPost.id}</strong>
                      </div>
                      <div className="detail-stat">
                        <span>Tác giả</span>
                        <strong>{selectedPost.author?.display_name || selectedPost.author?.email || '?'}</strong>
                      </div>
                      <div className="detail-stat">
                        <span>Ngày tạo</span>
                        <strong>{selectedPost.created_at ? new Date(selectedPost.created_at).toLocaleString('vi-VN') : '?'}</strong>
                      </div>
                      <div className="detail-stat">
                        <span>Loại media</span>
                        <strong>{selectedPost.media_type || '-'}</strong>
                      </div>
                      <div className="detail-stat">
                        <span>Model mô tả</span>
                        <strong>{activeAnalysis?.description_model || '-'}</strong>
                      </div>
                      <div className="detail-stat">
                        <span>Chế độ mô tả</span>
                        <strong>{activeAnalysis?.description_mode || '-'}</strong>
                      </div>
                      {activeAnalysis?.video_keyframes ? (
                        <div className="detail-stat">
                          <span>Số keyframe video</span>
                          <strong>{activeAnalysis.video_keyframes}</strong>
                        </div>
                      ) : null}
                    </div>

                    <div className="detail-section">
                      <h4>Nội dung bài đăng</h4>
                      <div className={`post-content-block ${contentExpanded ? 'expanded' : ''}`}>
                        {selectedPost.content || '(bài đăng ảnh)'}
                      </div>
                      {hasLongContent && (
                        <button
                          type="button"
                          className="content-toggle-btn"
                          onClick={() => setContentExpanded((v) => !v)}
                        >
                          {contentExpanded ? 'Thu gọn nội dung' : 'Xem thêm nội dung'}
                        </button>
                      )}
                    </div>

                    {activeAnalysis?.description ? (
                      <div className="detail-section">
                        <h4>Mô tả media</h4>
                        <div className="analysis-caption detail-caption detail-caption-box">
                          {activeAnalysis.description}
                        </div>
                      </div>
                    ) : null}

                    {activeAnalysis?.description_error ? (
                      <div className="detail-section">
                        <h4>Mô tả media</h4>
                        <div className="analysis-caption analysis-caption-error detail-caption detail-caption-box">
                          Mô tả media lỗi: {activeAnalysis.description_error}
                        </div>
                      </div>
                    ) : null}

                    {!activeAnalysis?.description && !activeAnalysis?.description_error ? (
                      <div className="detail-section">
                        <div className="muted">Chưa có mô tả media.</div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
