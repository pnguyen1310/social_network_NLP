// src/admin/api.js
import http from '../user/api/http';

export const admin = {
  stats() {
    return http.get('/admin/stats').then(r => r.data);
  },
  posts(params = {}) {
    return http.get('/admin/posts', { params }).then(r => r.data);
  },
  postDetail(id, params = {}) {
    return http.get(`/admin/posts/${id}`, { params }).then(r => r.data);
  },
  deletePost(id) {
    console.log(`[Admin API] Deleting post ${id}`);
    return http.delete(`/admin/posts/${id}`).then(r => {
      console.log(`[Admin API] Delete post ${id} response:`, r);
      // 204 No Content returns no data
      return r.data || {};
    }).catch(err => {
      console.error(`[Admin API] Delete post ${id} error:`, err);
      throw err;
    });
  },
  users(params = {}) {
    return http.get('/admin/users', { params }).then(r => r.data);
  },
  deleteUser(id) {
    return http.delete(`/admin/users/${id}`).then(r => r.data);
  },
  sentimentPosts(params = {}) {
    return http.get('/admin/sentiment/posts', { params }).then(r => r.data);
  },
  overallPosts(params = {}) {
    return http.get('/admin/overall/posts', { params, timeout: 120000 }).then(r => r.data);
  },
  ragChat(payload = {}) {
    return http.post('/admin/rag/chat', payload, { timeout: 120000 }).then(r => r.data);
  },
  visionPosts(params = {}) {
    return http.get('/admin/vision/posts', { params }).then(r => r.data);
  },
  analyzePostImage(postId, params = {}) {
    return http.post(`/admin/vision/posts/${postId}/analyze`, null, { params }).then(r => r.data);
  },
  reports(params = {}) {
    return http.get('/admin/reports', { params }).then(r => r.data);
  },
  toxicLanguagePosts(params = {}) {
    return http.get('/admin/toxic-language/posts', { params, timeout: 120000 }).then(r => r.data);
  },
  deleteReport(id) {
    console.log(`[Admin API] Deleting report ${id}`);
    return http.delete(`/admin/reports/${id}`).then(r => {
      console.log(`[Admin API] Delete report ${id} response:`, r);
      // 204 No Content returns no data
      return r.data || {};
    }).catch(err => {
      console.error(`[Admin API] Delete report ${id} error:`, err);
      throw err;
    });
  },
};
