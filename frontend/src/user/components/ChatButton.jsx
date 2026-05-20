import React, { useState } from 'react';
import ChatModal from './ChatModal';
import './ChatButton.css';

export default function ChatButton() {
  const initialMessages = [
    {
      id: Date.now(),
      text: 'Xin chào! Tôi là trợ lý ảo của bạn. Tôi có thể giúp gì cho bạn?',
      sender: 'bot',
      timestamp: new Date(),
    },
  ];

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState(initialMessages);

  const toggleChat = () => {
    setIsChatOpen((prev) => !prev);
  };

  const clearConversation = () => {
    setMessages(initialMessages);
  };

  return (
    <>
      {!isChatOpen && (
        <button className="chat-button" onClick={toggleChat} title="Chat với trợ lý">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      )}

      {isChatOpen && (
        <ChatModal
          onClose={toggleChat}
          messages={messages}
          setMessages={setMessages}
          onClearConversation={clearConversation}
        />
      )}
    </>
  );
}
