import http from './http';

export const getStats = () => http.get('/admin/stats');
export const listPosts = ({ q = '', limit = 20, offset = 0 } = {}) =>
	http.get('/admin/posts', { params: { q, limit, offset } });
export const getPost = (id) => http.get(`/admin/posts/${id}`);
export const deletePost = (id) => http.delete(`/admin/posts/${id}`);
export const listUsers = ({ q = '', limit = 20, offset = 0 } = {}) =>
	http.get('/admin/users', { params: { q, limit, offset } });
export const deleteUser = (id) => http.delete(`/admin/users/${id}`);
