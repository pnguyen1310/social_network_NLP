import http from "./http";

export function userChat(payload = {}) {
  return http.post("/user/chat", payload).then((res) => res.data);
}
