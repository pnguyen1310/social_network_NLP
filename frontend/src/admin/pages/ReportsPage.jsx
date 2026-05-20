// frontend/src/admin/pages/ReportsPage.jsx
import { useState, useEffect } from 'react';
import './ReportsPage.css';
import Toast from '../../components/Toast';
import { admin as api } from '../api';

function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const data = await api.reports();
      setReports(data.items || []);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('Bạn chắc chắn muốn xóa báo cáo này?')) return;
    
    try {
      await api.deleteReport(reportId);
      setReports(reports.filter(r => r.id !== reportId));
      setToast({ type: 'success', message: 'Xóa báo cáo thành công' });
    } catch (error) {
      console.error('Error deleting report:', error);
      setToast({ type: 'error', message: 'Lỗi khi xóa báo cáo' });
    }
  };

  const handleDeletePost = async (postId, reportId) => {
    if (!window.confirm('Bạn chắc chắn muốn xóa bài viết này? Hành động này không thể hoàn tác.')) return;
    
    try {
      await api.deletePost(postId);
      // Xóa báo cáo liên quan
      setReports(reports.filter(r => r.id !== reportId));
      setToast({ type: 'success', message: 'Xóa bài viết thành công' });
    } catch (error) {
      console.error('Error deleting post:', error);
      setToast({ type: 'error', message: 'Lỗi khi xóa bài viết' });
    }
  };

  if (loading) {
    return <div className="reports-loading">Đang tải...</div>;
  }

  return (
    <div className="reports-page">
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      
      <div className="reports-header">
        <h1>Quản lý báo cáo</h1>
        <p className="reports-count">Tổng số: {reports.length} báo cáo</p>
      </div>

      <div className="reports-list">
        {reports.length === 0 ? (
          <div className="reports-empty">Không có báo cáo nào</div>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="report-card">
              <div className="report-info">
                <div className="report-meta">
                  <span className="report-id">#{report.id}</span>
                  <span className="report-date">{formatDate(report.created_at)}</span>
                </div>
                
                {report.reporter && (
                  <div className="report-reporter">
                    <strong>Người báo cáo:</strong> {report.reporter.display_name || report.reporter.username}
                  </div>
                )}
              </div>

              {report.post && (
                <div className="report-post">
                  <div className="post-header">
                    <span className="post-label">Bài viết bị báo cáo (ID: {report.post.id})</span>
                    {report.post.author && (
                      <span className="post-author">
                        Đăng bởi: {report.post.author.display_name || report.post.author.username}
                      </span>
                    )}
                  </div>
                  
                  <div className="post-content">
                    <p>{report.post.content || '(Bài viết không có nội dung text)'}</p>
                  </div>

                  {report.post.media_url && (
                    <div className="post-media">
                      {report.post.media_url.match(/\.(mp4|webm|ogg)$/i) ? (
                        <video controls src={`http://localhost:8000${report.post.media_url}`} />
                      ) : (
                        <img src={`http://localhost:8000${report.post.media_url}`} alt="Post media" />
                      )}
                    </div>
                  )}

                  <div className="post-stats">
                    <span>{report.post.like_count || 0} lượt thích</span>
                    <span>{report.post.comment_count || 0} bình luận</span>
                    <span>Đăng lúc: {formatDate(report.post.created_at)}</span>
                  </div>

                  <div className="post-actions">
                    <button 
                      className="btn-delete-post"
                      onClick={() => handleDeletePost(report.post.id, report.id)}
                      title="Xóa bài viết"
                    >
                      Xóa bài viết
                    </button>
                    <button 
                      className="btn-dismiss-report"
                      onClick={() => handleDeleteReport(report.id)}
                      title="Xóa báo cáo"
                    >
                      ✕ Bỏ qua báo cáo
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ReportsPage;
