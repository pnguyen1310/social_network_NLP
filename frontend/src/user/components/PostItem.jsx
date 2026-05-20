import React, { useState, useRef, useEffect } from 'react';
import { ThumbsUp, MessageSquare, Trash2, Edit, Flag } from 'lucide-react';
import './PostItem.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

function Avatar({ user, size = 40 }) {
  const url = user?.avatar_url ? `${API_BASE}${user.avatar_url}` : null;
  return (
    <div
      className="post-avatar"
      style={{
        width: size,
        height: size,
        minWidth: size,
      }}
    >
      {url ? (
        <img src={url} alt={user?.display_name || 'User'} />
      ) : (
        <div className="avatar-placeholder">{(user?.display_name || 'U').charAt(0).toUpperCase()}</div>
      )}
    </div>
  );
}

export default function PostItem({
  post,
  onLike,
  onComment,
  onDelete,
  onEdit,
  onReport,
  isLiked = false,
  currentUserId = null,
}) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const handleLikeClick = () => {
    onLike?.(post.id);
  };

  const handleCommentSubmit = () => {
    if (commentText.trim()) {
      onComment?.(post.id, commentText.trim());
      setCommentText('');
      setShowCommentInput(false);
    }
  };

  const isOwnPost = currentUserId === post.author?.id;
  const hasMedia = post.media_url && (post.media_type === 'image' || post.media_type === 'video');

  return (
    <div className="post-card">
      {/* Header */}
      <div className="post-header">
        <div className="post-author-info">
          <Avatar user={post.author} size={40} />
          <div className="post-author-details">
            <div className="post-author-name">{post.author?.display_name || 'Người dùng'}</div>
            <div className="post-meta">
              <time>{new Date(post.created_at).toLocaleString()}</time>
              <span className="separator">·</span>
              <span className="privacy">Công khai</span>
            </div>
          </div>
        </div>
        <div className="post-menu-wrapper" ref={menuRef}>
          <button
            className="post-menu-btn"
            onClick={() => setShowMenu(!showMenu)}
            title="Tùy chọn"
          >
            ⋯
          </button>
          {showMenu && (
            <div className="post-menu-dropdown">
              {isOwnPost ? (
                <>
                  {onEdit && (
                    <button
                      className="menu-item edit"
                      onClick={() => {
                        onEdit?.(post.id);
                        setShowMenu(false);
                      }}
                    >
                      <Edit size={16} />
                      <span>Sửa bài viết</span>
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="menu-item delete"
                      onClick={() => {
                        onDelete?.(post.id);
                        setShowMenu(false);
                      }}
                    >
                      <Trash2 size={16} />
                      <span>Xóa bài viết</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {onReport && (
                    <button
                      className="menu-item report"
                      onClick={() => {
                        onReport?.(post.id);
                        setShowMenu(false);
                      }}
                    >
                      <Flag size={16} />
                      <span>Báo cáo bài viết</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="post-content">
        <p>{post.content}</p>
      </div>

      {/* Media */}
      {hasMedia && (
        <div className="post-media-container">
          {post.media_type === 'video' ? (
            <video
              className="post-media"
              controls
              src={`${API_BASE}${post.media_url}`}
            />
          ) : (
            <img
              className="post-media"
              src={`${API_BASE}${post.media_url}`}
              alt="Post media"
            />
          )}
        </div>
      )}

      {/* Stats */}
      <div className="post-stats">
        <div className="stats-item">
          <ThumbsUp className="icon-stat" size={16} />
          <span className="stat-count">{post.like_count ?? 0}</span>
        </div>
        <div className="stats-item">
          <MessageSquare className="icon-stat" size={16} />
          <span className="stat-count">{post.comment_count ?? post.comments?.length ?? 0} bình luận</span>
        </div>
      </div>

      {/* Actions */}
      <div className="post-actions">
        <button
          className={`action-btn like-btn ${isLiked ? 'liked' : ''}`}
          onClick={handleLikeClick}
        >
          <ThumbsUp 
            size={20}
            strokeWidth={1.5}
            fill={isLiked ? 'currentColor' : 'none'}
          />
          <span className="like-text">{isLiked ? 'Đã thích' : 'Thích'}</span>
        </button>
        <button
          className="action-btn comment-btn"
          onClick={() => onComment?.(post.id)}
        >
          <MessageSquare 
            size={20} 
            strokeWidth={1.5}
          />
          <span className="comment-text">Bình luận</span>
        </button>
      </div>

      {/* Comment Input */}
      {showCommentInput && (
        <div className="comment-composer">
          <Avatar user={{ display_name: 'You' }} size={32} />
          <div className="comment-input-wrap">
            <textarea
              className="comment-input"
              placeholder="Viết bình luận..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleCommentSubmit();
                }
              }}
              rows={2}
            />
            <div className="comment-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setShowCommentInput(false);
                  setCommentText('');
                }}
              >
                Hủy
              </button>
              <button
                className="btn-submit"
                onClick={handleCommentSubmit}
                disabled={!commentText.trim()}
              >
                Gửi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}