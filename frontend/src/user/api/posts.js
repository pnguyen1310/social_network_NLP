import http from './http'
export async function createPost(token, payload){ const res = await http.post('/posts', payload, { headers: { Authorization: 'Bearer ' + token } }); return res.data; }
export async function listPosts(page=1, limit=20){ const res = await http.get(`/posts?page=${page}&limit=${limit}`); return res.data; }
export async function listUserPosts(userId, page=1, limit=20){ const res = await http.get(`/users/${userId}/posts?page=${page}&limit=${limit}`); return res.data; }
export async function createComment(token, postId, payload){ const res = await http.post(`/posts/${postId}/comments`, payload, { headers: { Authorization: 'Bearer ' + token } }); return res.data; }