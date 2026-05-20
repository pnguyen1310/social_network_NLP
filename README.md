# Hệ thống phát hiện sớm trạng thái cảm xúc không tích cực trên mạng xã hội sinh viên

## 1. Tổng quan

Dự án là một hệ thống mạng xã hội nội bộ dành cho sinh viên, tích hợp:
- đăng ký/đăng nhập
- đăng bài, like, comment, báo cáo
- quản lý người dùng và admin dashboard
- cảnh báo nội dung không phù hợp / cảm xúc tiêu cực
- thông báo realtime qua WebSocket
- chat AI tiếng Việt
- admin review và phân tích sentiment/toxic/vision/RAG

Mục tiêu chính là phát hiện sớm những trạng thái cảm xúc tiêu cực hoặc nội dung độc hại trong các bài đăng của sinh viên, đồng thời cung cấp công cụ quản trị để theo dõi và xử lý.

## 2. Kiến trúc tổng quan

### 2.1 Backend
- Ngôn ngữ: Python
- Web framework: FastAPI
- ORM: SQLAlchemy
- Validation: Pydantic
- Authentication: JWT Bearer token
- Realtime: WebSocket
- Static file serving: FastAPI `StaticFiles`

### 2.2 Frontend
- Thư viện: React
- Bundler: Vite
- HTTP client: Axios
- Routing nội bộ: BrowserRouter + custom page state
- Charting: Chart.js + react-chartjs-2

### 2.3 AI / ML
- Sentiment classification: local model trong `ViBert/` sử dụng `transformers`
- Chatbot tiếng Việt: Qwen-LoRA adapter trong `qwen_lora_adapter/` với `transformers` + `peft`
- Toxic detection và Vision / RAG: có thể gọi dịch vụ Groq API từ backend nếu cấu hình API key

## 3. Cấu trúc thư mục chính

- `backend/`
  - `main.py`: entrypoint FastAPI
  - `db.py`: cấu hình SQLAlchemy
  - `realtime.py`: manager WebSocket realtime
  - `utils/jwt.py`: tạo và giải mã JWT
  - `services/notify.py`: tạo và broadcast notification
  - `routes/`: các endpoint REST
  - `models/`: các bảng dữ liệu SQLAlchemy
  - `uploads/`: lưu ảnh avatar và media bài viết

- `frontend/`
  - `src/App.jsx`: ứng dụng chính
  - `src/main.jsx`: mount React
  - `src/user/`: UI người dùng thông thường
  - `src/admin/`: dashboard quản trị và phân tích
  - `src/user/api/`: các service gọi API

- `ViBert/`: model sentiment classification
- `qwen_lora_adapter/`: adapter model Qwen-LoRA cho chatbot

## 4. Các model AI

### 4.1 Sentiment model
- Thư mục: `ViBert/`
- Mục đích: phân tích sentiment cho nội dung bài viết, comment và phân tích tổng thể.
- Backend sử dụng:
  - `transformers.AutoModelForSequenceClassification` để tải model phân loại
  - `transformers.AutoTokenizer` để tokenize văn bản
- Cách hoạt động:
  - Model được nạp từ thư mục `ViBert/` và lưu trong cache với `@lru_cache(maxsize=1)` để không tải lại nhiều lần.
  - Văn bản được chuẩn hoá bằng `_normalize_post_text()` (loại bỏ khoảng trắng thừa) rồi tokenized với `truncation=True`, `max_length=256` và padding về batch.
  - Kết quả trả về là logits, sau đó áp dụng softmax để ra xác suất mỗi nhãn.
  - Nhãn cuối cùng được chọn bằng `argmax`, kèm theo `score` (xác suất nhãn được chọn) và `label_id`.
- Lưu trữ kết quả:
  - Cache sentiment được ghi vào bảng `post_sentiment_cache` qua model `backend/models/post_sentiment_cache.py`.
  - Trường dữ liệu gồm: `post_id`, `content_hash`, `sentiment_label`, `sentiment_label_id`, `sentiment_score`, `model_ref`, `analyzed_at`.
- Lưu ý:
  - Model reference được cấu hình qua biến môi trường `SENTIMENT_MODEL_REF` (mặc định là thư mục `ViBert/`).
  - Nếu thư mục model không tồn tại, backend sẽ báo lỗi khi gọi tính năng phân tích sentiment.

### 4.2 Toxic language detection
- Logic chính nằm trong `backend/routes/admin.py` và được gọi tự động khi tạo bài trong `backend/routes/posts.py`.
- Cách hoạt động:
  - Hàm `_analyze_toxic_vietnamese_text_with_groq()` chuẩn hoá văn bản rồi xây dựng prompt JSON cho Groq API.
  - Prompt yêu cầu đánh giá tiếng Việt, trả về cấu trúc JSON bao gồm `is_toxic`, `toxic_score`, `reason`, `categories`, `matched_terms`.
  - Nếu bài viết có nội dung độc hại hoặc `toxic_score` cao, hệ thống có thể gửi notification tới user hoặc cảnh báo admin.
- Thành phần bổ sung:
  - Danh sách từ khóa Việt Nam (`VI_PROFANITY_KEYWORDS`) được sử dụng để phát hiện nhanh các từ tục tĩu, chửi bới, xúc phạm.
  - Hàm `_extract_vietnamese_profanity_terms()` kiểm tra từ khóa và trả lại các cụm từ trùng khớp.
- Lưu trữ kết quả:
  - Cache toxic language được lưu tại bảng `toxic_language_cache` trong `backend/models/toxic_language_cache.py`.
  - Dữ liệu gồm: `post_id`, `content_hash`, `is_toxic`, `toxic_score`, `severity`, `reason`, `categories_json`, `matched_terms_json`, `model`, `source`, `error`, `error_code`, `analyzed_at`.
- Cấu hình:
  - Nếu có API key Groq, biến `GROQ_API_KEY` được dùng để gọi dịch vụ.
  - Mô hình Groq cho toxic được cấu hình qua `GROQ_TOXIC_MODEL`.

### 4.3 Chatbot AI
- Thư mục: `qwen_lora_adapter/`
- Endpoint: `POST /user/chat`
- Backend sử dụng:
  - `transformers.AutoTokenizer` để tải tokenizer adapter
  - `transformers.AutoModelForCausalLM` để tải nền tảng LLM base
  - `peft.PeftModel` để tải adapter LoRA trên base model
- Cách hoạt động:
  - Khi backend startup hoặc lần đầu gọi chat, `user_chat._load_chat_model()` nạp tokenizer và model.
  - Base model lấy từ biến môi trường `QWEN_LORA_BASE_MODEL`, adapter LoRA lấy từ thư mục `qwen_lora_adapter/`.
  - Nếu GPU có sẵn, model sử dụng `torch.float16` và `device_map='auto'`; nếu không, dùng `torch.float32` trên CPU.
  - Mỗi request chat nhận `messages` gồm các role `user`, `assistant`, `system`.
  - Hệ thống thêm prompt mặc định `QWEN_LORA_SYSTEM_PROMPT` để bắt model trả lời tiếng Việt chính xác, súc tích, không lan man, không bịa đặt.
  - Lịch sử hội thoại bị cắt giữ lại tối đa 6 lượt gần nhất để tránh quá dài.
  - Nội dung được encode bằng tokenizer, chạy generative với `generate()` và các tham số:
    - `max_new_tokens`
    - `temperature`
    - `top_p`
    - `repetition_penalty`
  - Kết quả raw output được làm sạch bằng `_clean_assistant_reply()` để bỏ role marker và format không cần thiết.
- Trả về:
  - `reply`: câu trả lời đã tinh chỉnh
  - `raw_reply`: nội dung thô đã loại bỏ label
  - `processing_time_ms`: thời gian xử lý
- Lưu ý:
  - Model LoRA này là phương án fine-tuning nhỏ trên một base model lớn, nên tiết kiệm bộ nhớ hơn so với tải toàn bộ base-only model.
  - Nếu thư mục adapter không tồn tại, endpoint sẽ trả lỗi `503`.

### 4.4 RAG và Vision
- `backend/routes/admin_rag.py` cung cấp tính năng RAG chat và quản lý chỉ mục embedding.
- Chức năng chính:
  - Chia nhỏ nội dung bài viết thành các chunk với `RAG_CHUNK_SIZE` và `RAG_CHUNK_OVERLAP`.
  - Tạo embedding cho mỗi chunk bằng model `RAG_EMBEDDING_MODEL` (mặc định `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`).
  - Lưu embedding vào bảng `rag_document_index` của SQLAlchemy.
  - Dùng reranker `CrossEncoder` từ `sentence_transformers` với model `RAG_RERANK_MODEL` để chọn các chunk quan trọng nhất dựa trên câu hỏi.
- Vision/scan:
  - Nếu cấu hình `GROQ_API_KEY`, backend có thể gọi Groq API để phân tích hình ảnh/video.
  - Các phân tích hình ảnh/video được dùng để tăng thông tin trong RAG và đánh giá nội dung truyền thông.
- Lưu trữ và cache:
  - `rag_document_index` lưu các chunk text, embedding, `content_hash`, và model reference.
  - `overall_analysis_cache` lưu kết quả tổng hợp phân tích cho một `post_id` cùng `input_hash` để tránh tính toán lại khi cùng đầu vào.

## 5. Luồng hoạt động chính

### 5.1 Đăng ký / đăng nhập
- `POST /auth/register`: tạo tài khoản mới
- `POST /auth/login`: đăng nhập người dùng
- `POST /auth/admin/login`: đăng nhập admin
- `GET /auth/me`: lấy thông tin user hiện tại

### 5.2 Quản lý người dùng
- `GET /users`: danh sách người dùng
- `GET /users/search`: tìm người dùng
- `GET /users/me`: thông tin hiện tại
- `GET /users/{user_id}`: chi tiết user
- `POST /users/me/avatar`: upload avatar
- `DELETE /users/me/avatar`: xóa avatar

### 5.3 Bài viết
- `POST /posts/`: tạo bài viết text / media
- `GET /posts/`: lấy danh sách bài viết
- `POST /posts/{post_id}/like`: like/unlike bài viết
- `GET /posts/{post_id}/comments`: lấy comment
- `POST /posts/{post_id}/comments`: thêm comment
- `PUT /posts/{post_id}`: cập nhật bài viết
- `DELETE /posts/{post_id}`: xóa bài viết
- `POST /posts/{post_id}/report`: báo cáo bài viết

### 5.4 Thông báo realtime
- WebSocket endpoint: `/ws/{user_id}`
- Backend `backend/realtime.py` quản lý kết nối
- `backend/services/notify.py` tạo notification và push realtime
- REST API đọc thông báo:
  - `GET /notifications`
  - `PUT /notifications/mark_all_read`
  - `PUT /notifications/{id}/read`

### 5.5 Chat AI người dùng
- `POST /user/chat`: gửi message tới chatbot
- `GET /user/health`: kiểm tra trạng thái model
- Chat model được nạp từ `qwen_lora_adapter/`

### 5.6 Admin và phân tích
- Các trang admin gọi API trong `frontend/src/admin/api.js`
- Backend cung cấp phân tích:
  - sentiment posts
  - overall analysis
  - toxic language posts
  - vision analysis
  - RAG chat

## 6. API call và frontend integration

### 6.1 Base API
- Base URL lấy từ môi trường:
  - `VITE_API_BASE` hoặc `VITE_API_BASE_URL`
  - nếu không có thì mặc định `http://localhost:8000`

### 6.2 Axios HTTP client
- `frontend/src/user/api/http.js`
- Gắn `Authorization: Bearer <token>` tự động nếu có token trong `localStorage`
- Xử lý lỗi 401 chung để logout

### 6.3 WebSocket
- `frontend/src/App.jsx` mở kết nối tới `/ws/{me.id}`
- Nhận message realtime và thêm notification mới

### 6.4 Các module UI chính
- `frontend/src/user/pages/Feed.jsx`: feed bài viết
- `frontend/src/user/pages/Profile.jsx`: trang profile
- `frontend/src/user/pages/Login.jsx`: đăng nhập
- `frontend/src/admin/pages/OverallAnalysisPage.jsx`: admin phân tích tổng thể
- `frontend/src/admin/pages/SentimentPage.jsx`: admin sentiment
- `frontend/src/admin/pages/ToxicLanguagePage.jsx`: admin toxic language
- `frontend/src/admin/pages/VisionPage.jsx`: admin vision
- `frontend/src/admin/pages/AdminRagChatPage.jsx`: admin RAG chat

## 7. Thiết lập và chạy dự án

### 7.1 Backend
1. Điều hướng vào thư mục backend:
   ```bash
   cd backend
   ```
2. Cài dependencies Python:
   ```bash
   pip install -r requirements.txt
   ```
3. Thiết lập biến môi trường trong `.env` (hoặc export trực tiếp):
   - `DATABASE_URL`
   - `GROQ_API_KEY` (nếu dùng Groq API)
   - `ADMIN_EMAIL`
   - `QWEN_LORA_ADAPTER_DIR` (nếu cần)
   - `QWEN_LORA_BASE_MODEL` (nếu dùng model cục bộ)
   - `SENTIMENT_MODEL_REF` (thư mục `ViBert/`)

4. Chạy server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

### 7.2 Frontend
1. Điều hướng vào thư mục frontend:
   ```bash
   cd frontend
   ```
2. Cài dependencies:
   ```bash
   npm install
   ```
3. Chạy dev server:
   ```bash
   npm run dev
   ```

## 8. Gợi ý cấu hình GitHub

Nên dùng `.gitignore` để loại trừ:
- `backend/uploads/`
- `frontend/node_modules/`
- `.venv/`, `venv/`
- file `.env`
- model/binary lớn như `*.safetensors`, `*.pth`, `*.pt`

## 9. Các file quan trọng để đọc nhanh

### Backend
- `backend/main.py`
- `backend/db.py`
- `backend/routes/auth.py`
- `backend/routes/users.py`
- `backend/routes/posts.py`
- `backend/routes/notifications.py`
- `backend/routes/user_chat.py`
- `backend/routes/admin.py`
- `backend/routes/admin_rag.py`
- `backend/realtime.py`
- `backend/services/notify.py`
- `backend/utils/jwt.py`

### Frontend
- `frontend/src/App.jsx`
- `frontend/src/main.jsx`
- `frontend/src/user/api/http.js`
- `frontend/src/user/pages/Feed.jsx`
- `frontend/src/admin/api.js`
- `frontend/src/admin/pages/OverallAnalysisPage.jsx`

### AI model
- `ViBert/`
- `qwen_lora_adapter/`

## 10. Lưu ý đặc biệt

- Backend không tự sửa schema khi thay đổi, `Base.metadata.create_all()` chỉ tạo bảng nếu chưa có.
- `backend/routes/posts.py` có cơ chế auto-scan toxic khi tạo bài, dùng `backend/routes/admin.py` để phân tích.
- Chat AI hiện tại là model local, có thể tốn bộ nhớ và thời gian nếu không có GPU.
- Admin RAG/vision cần cấu hình Groq API nếu muốn dùng dịch vụ ngoài.

---

Nếu cần, tôi có thể bổ sung thêm phần `Flowchart`, `Sequence diagram` hoặc hướng dẫn chi tiết `deployment` cho hệ thống này.
