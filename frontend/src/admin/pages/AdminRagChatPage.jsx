import React, { useEffect, useMemo, useRef, useState } from 'react';
import { admin as api } from '../api';
import './AdminRagChatPage.css';

const CHAT_MESSAGES_STORAGE_KEY = 'admin_rag_chat_messages_v1';
const CHAT_DRAFT_STORAGE_KEY = 'admin_rag_chat_draft_v1';

const QUICK_PROMPTS = [
  {
    title: 'Tóm tắt tiêu cực gần đây',
    desc: 'Rút gọn 5 bài tiêu cực mới nhất và nguyên nhân chính.',
    prompt: 'Tóm tắt 5 bài tiêu cực gần đây và nguyên nhân chính',
  },
  {
    title: 'Cảnh báo khủng hoảng',
    desc: 'Nhóm các bài có dấu hiệu rủi ro truyền thông cao.',
    prompt: 'Nhóm các bài đang có rủi ro khủng hoảng truyền thông',
  },
  {
    title: 'Top bài tích cực',
    desc: 'Liệt kê các bài có sentiment tích cực nhất và lý do.',
    prompt: 'Liệt kê bài có sentiment tích cực nhất kèm lý do',
  },
];

const buildGreetingMessage = () => ({
  role: 'assistant',
  text: 'Xin chào bạn, mình là RAG Admin Assistant. Mình có thể tóm tắt xu hướng, cảnh báo rủi ro và truy xuất bài viết liên quan. Bạn muốn bắt đầu từ đâu?',
  createdAt: new Date().toISOString(),
});

const loadStoredMessages = () => {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const safe = parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => ({
        role: m.role,
        text: String(m.text || ''),
        citations: Array.isArray(m.citations) ? m.citations : [],
        showCitations: typeof m.showCitations === 'boolean' ? m.showCitations : null,
        answerType: m.answerType || null,
        retrievalMode: m.retrievalMode || null,
        retrievedCount: typeof m.retrievedCount === 'number' ? m.retrievedCount : null,
        embeddingModel: m.embeddingModel || null,
        createdAt: m.createdAt || new Date().toISOString(),
      }))
      .filter((m) => String(m.text || '').trim());

    return safe.length ? safe : null;
  } catch {
    return null;
  }
};

const loadStoredDraft = () => {
  try {
    if (typeof window === 'undefined') return '';
    return String(window.localStorage.getItem(CHAT_DRAFT_STORAGE_KEY) || '');
  } catch {
    return '';
  }
};

export default function AdminRagChatPage() {
  const [question, setQuestion] = useState(() => loadStoredDraft());
  const [messages, setMessages] = useState(() => loadStoredMessages() || [buildGreetingMessage()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const chatBoxRef = useRef(null);

  const messageCountText = useMemo(() => {
    const total = messages.length;
    if (!total) return 'Chưa có tin nhắn';
    return `${total} tin nhắn`;
  }, [messages]);

  useEffect(() => {
    if (!chatBoxRef.current) return;
    chatBoxRef.current.scrollTo({ top: chatBoxRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(
        CHAT_MESSAGES_STORAGE_KEY,
        JSON.stringify(messages.slice(-200))
      );
    } catch {
      // Ignore storage failures (quota/private mode).
    }
  }, [messages]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (question) {
        window.localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, question);
      } else {
        window.localStorage.removeItem(CHAT_DRAFT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [question]);

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessageText = (text) => {
    if (!text) return '';
    
    const paragraphs = String(text)
      .split(/\n\n+/)
      .filter(p => p.trim());
    
    if (paragraphs.length === 1) {
      return <div className="rag-text">{renderParagraphWithFormatting(paragraphs[0])}</div>;
    }
    
    return (
      <div className="rag-text-multi">
        {paragraphs.map((para, idx) => {
          // Check if this paragraph is a bullet list
          const lines = para.split('\n');
          const isList = lines.some(l => l.trim().startsWith('-'));
          
          if (isList) {
            return (
              <ul key={idx} className="rag-bullet-list">
                {lines.map((line, lineIdx) => {
                  if (line.trim().startsWith('-')) {
                    const content = line.trim().substring(1).trim();
                    return <li key={lineIdx}>{renderInlineFormatting(content)}</li>;
                  }
                  return null;
                }).filter(Boolean)}
              </ul>
            );
          }

          const isPipeLine = lines.length === 1 && lines[0].includes('|');
          if (isPipeLine) {
            const parts = lines[0].split('|').map((part) => part.trim()).filter(Boolean);
            return (
              <div key={idx} className="rag-stat-row">
                {parts.map((part, partIdx) => (
                  <span
                    key={partIdx}
                    className={partIdx === 0 ? 'rag-stat-head' : 'rag-stat-chip'}
                  >
                    {renderInlineFormatting(part)}
                  </span>
                ))}
              </div>
            );
          }
          
          return (
            <p key={idx} className="rag-text-para">
              {renderParagraphWithFormatting(para)}
            </p>
          );
        })}
      </div>
    );
  };

  const renderParagraphWithFormatting = (text) => {
    return renderInlineFormatting(text);
  };

  const renderInlineFormatting = (text) => {
    // Parse **bold** and other inline formatting
    const parts = [];
    let lastIndex = 0;
    const boldRegex = /\*\*(.+?)\*\*/g;
    let match;

    while ((match = boldRegex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      // Add bold text
      parts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const ask = async () => {
    const q = String(question || '').trim();
    if (!q || loading) return;

    const nextMessages = [...messages, { role: 'user', text: q, createdAt: new Date().toISOString() }];
    setMessages(nextMessages);
    setQuestion('');
    setLoading(true);
    setError('');

    try {
      const history = nextMessages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const resp = await api.ragChat({ question: q, history });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: resp?.answer || 'Không có phản hồi từ chatbot.',
          citations: [],
          showCitations: false,
          answerType: resp?.answer_type || null,
          retrievalMode: resp?.retrieval_mode || null,
          retrievedCount: typeof resp?.retrieved_count === 'number' ? resp.retrieved_count : null,
          embeddingModel: resp?.embedding_model || null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.message || 'Lỗi không xác định';
      setError([status ? `HTTP ${status}` : null, detail].filter(Boolean).join(' - '));
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Hiện chưa thể trả lời. Vui lòng thử lại sau.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const clearChat = () => {
    if (loading) return;
    setMessages([buildGreetingMessage()]);
    setQuestion('');
    setError('');
  };

  return (
    <div className="rag-page">
      <section className="rag-chat-shell">
        <header className="rag-chat-topbar">
          <div className="rag-chat-identity">
            <div className="rag-chat-avatar" aria-hidden="true">
              AI
            </div>
            <div>
              <h2>RAG Admin Assistant</h2>
              <p>{loading ? 'Đang soạn trả lời...' : 'Online'} • {messageCountText}</p>
            </div>
          </div>
          <div className="rag-chat-actions">
            <button className="rag-clear-btn" type="button" onClick={clearChat} disabled={loading || messages.length === 0}>
              Xóa hội thoại
            </button>
          </div>
        </header>

        <div className="rag-chat-box" role="log" aria-live="polite" ref={chatBoxRef}>
          {messages.map((m, idx) => (
            <article key={`${m.role}-${idx}`} className={`rag-msg-row ${m.role}`}>
              <div className="rag-msg-avatar" aria-hidden="true">
                {m.role === 'user' ? 'U' : 'AI'}
              </div>
              <div className={`rag-msg ${m.role}`}>
                <div className="rag-role">{m.role === 'user' ? 'Bạn' : 'RAG Admin'}</div>
                {m.role === 'assistant' ? renderMessageText(m.text) : <div className="rag-text">{m.text}</div>}
                <div className="rag-time">{formatTime(m.createdAt)}</div>
              </div>
            </article>
          ))}

          {loading && (
            <article className="rag-msg-row assistant">
              <div className="rag-msg-avatar" aria-hidden="true">AI</div>
              <div className="rag-msg assistant rag-typing">
                <div className="rag-role">RAG Admin</div>
                <div className="rag-typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          )}
        </div>

        {error && <div className="rag-error">{error}</div>}

        <div className="rag-input-row">
          <div className="rag-input-prompts-wrap">
            <div className="rag-input-prompts-label">Gợi ý nhanh</div>
            <div className="rag-input-prompts" aria-label="Gợi ý nhanh">
              {QUICK_PROMPTS.map((item, i) => (
                <button
                  key={`inline-prompt-${i}`}
                  type="button"
                  className="rag-input-prompt-btn"
                  onClick={() => setQuestion(item.prompt)}
                >
                  <span className="rag-input-prompt-dot" aria-hidden="true" />
                  {item.title}
                </button>
              ))}
            </div>
          </div>

          <div className="rag-composer">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Nhập tin nhắn cho RAG Admin..."
              rows={1}
            />
            <button
              className="rag-send-btn"
              onClick={ask}
              disabled={loading || !String(question || '').trim()}
              aria-label={loading ? 'Đang gửi' : 'Gửi tin nhắn'}
              title={loading ? 'Đang gửi' : 'Gửi tin nhắn'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 20l18-8L3 4v6l10 2-10 2v6z" />
              </svg>
            </button>
          </div>

          <div className="rag-input-hint">Enter để gửi</div>
        </div>
      </section>
    </div>
  );
}
