import React, { useState } from 'react';
import { BarChart3, Users, FileText, AlertCircle, Smile, ScanSearch, Sparkles, MessageCircle, ChevronDown } from 'lucide-react';
import '../sidebar/Sidebar.css';

export default function Sidebar({ activeTab, onTabChange }) {
  const [reportsOpen, setReportsOpen] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'posts', label: 'Bài viết', icon: FileText },
    { id: 'users', label: 'Người dùng', icon: Users },
    { id: 'sentiment', label: 'Phân tích cảm xúc', icon: Smile },
    { id: 'vision', label: 'Phân tích media', icon: ScanSearch },
    { id: 'overall', label: 'Phân tích chung', icon: Sparkles },
    { id: 'rag', label: 'Chatbot RAG', icon: MessageCircle },
  ];

  return (
    <aside className="admin-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Admin Panel</h1>
      </div>

      <nav className="sidebar-nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}

        <div className={`nav-group ${activeTab === 'reports' || activeTab === 'toxic-language' ? 'active' : ''}`}>
          <button
            className={`nav-item nav-parent ${activeTab === 'reports' || activeTab === 'toxic-language' ? 'active' : ''}`}
            onClick={() => setReportsOpen((v) => !v)}
            type="button"
          >
            <AlertCircle size={20} />
            <span>Báo cáo</span>
            <ChevronDown size={16} className={`nav-caret ${reportsOpen ? 'open' : ''}`} />
          </button>

          {reportsOpen && (
            <div className="nav-submenu">
              <button
                className={`nav-subitem ${activeTab === 'reports' ? 'active' : ''}`}
                onClick={() => onTabChange('reports')}
                type="button"
              >
                Báo cáo bài viết
              </button>
              <button
                className={`nav-subitem ${activeTab === 'toxic-language' ? 'active' : ''}`}
                onClick={() => onTabChange('toxic-language')}
                type="button"
              >
                Phát hiện ngôn ngữ độc hại
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-info">
          <p className="text-sm">Created by PNguyen</p>
        </div>
      </div>
    </aside>
  );
}
