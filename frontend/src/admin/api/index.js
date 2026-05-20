// src/admin/api.js
import http from '../../user/api/http';

export const admin = {
  stats() {
    return http.get('/admin/stats').then(r => r.data);
  },
  posts(params = {}) {
    return http.get('/admin/posts', { params }).then(r => r.data);
  },
  postDetail(id) {
    return http.get(`/admin/posts/${id}`).then(r => r.data);
  },
  deletePost(id) {
    return http.delete(`/admin/posts/${id}`).then(r => r.data);
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
};
