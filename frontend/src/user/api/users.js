import http from './http'
export async function searchUsers(name){ const res = await http.get(`/users/search?name=${encodeURIComponent(name)}`); return res.data; }