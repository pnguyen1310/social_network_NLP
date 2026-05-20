import React, { useState } from 'react';
import './ChatModal.css';
import { userChat } from '../api/chat';

export default function ChatModal({ onClose, messages, setMessages, onClearConversation }) {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendMessageToBackend = async (text, historyMessages) => {
    const history = historyMessages.map((message) => ({
      role: message.sender === 'bot' ? 'assistant' : 'user',
      content: message.text,
    }));

    try {
      const response = await userChat({
        messages: [...history, { role: 'user', content: text }],
      });
      return {
        reply: response.reply || response.answer || null,
        raw: response.raw_reply || null,
      };
    } catch (err) {
      console.error('[ChatModal] userChat error', err);
      if (err?.response?.data?.detail) {
        return `Lỗi: ${err.response.data.detail}`;
      }
      return 'Đã xảy ra lỗi khi gọi chatbot. Vui lòng thử lại sau.';
    }
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === '' || loading) return;

    const text = inputValue.trim();
    const userMessage = {
      id: Date.now(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };

    const history = [...messages, userMessage];
    setMessages(history);
    setInputValue('');
    setLoading(true);
    setError('');

    const botResp = await sendMessageToBackend(text, history);

    const messageText = botResp.reply || botResp.raw || 'Không có phản hồi từ chatbot.';

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + 1,
        text: messageText,
        sender: 'bot',
        timestamp: new Date(),
      },
    ]);
    setLoading(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearConversation = () => {
    onClearConversation();
    setInputValue('');
    setError('');
  };

  return (
    <div className="chat-modal-container">
      <div className="chat-modal">
        <div className="chat-modal-header">
          <h3>Trợ lý Chat</h3>
          <div className="chat-header-actions">
            <button className="chat-clear-btn" onClick={handleClearConversation} title="Xóa hội thoại">
              Xóa
            </button>
            <button className="chat-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.sender}`}>
              <div className="message-content">{message.text}</div>
              <div className="message-time">
                {message.timestamp.toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-message bot typing">
              <div className="message-content">
                <div className="typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="chat-error">{error}</div>}

        <div className="chat-input-area">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Nhập tin nhắn..."
            rows="3"
          />
          <button
            className="chat-send-btn"
            onClick={handleSendMessage}
            disabled={inputValue.trim() === '' || loading}
          >
            {loading ? 'Đang suy nghĩ...' : 'Gửi'}
          </button>
        </div>
      </div>
    </div>
  );
}
