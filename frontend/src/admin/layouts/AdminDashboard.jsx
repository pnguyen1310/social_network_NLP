import React, { useState } from 'react';
import Sidebar from '../components/sidebar/Sidebar';
import Header from '../components/header/Header';
import DashboardPage from '../pages/DashboardPage';
import PostsPage from '../pages/PostsPage';
import UsersPage from '../pages/UsersPage';
import ReportsPage from '../pages/ReportsPage';
import SentimentPage from '../pages/SentimentPage';
import VisionPage from '../pages/VisionPage';
import OverallAnalysisPage from '../pages/OverallAnalysisPage';
import AdminRagChatPage from '../pages/AdminRagChatPage';
import ToxicLanguagePage from '../pages/ToxicLanguagePage';
import '../styles/AdminDashboard.css';

export default function AdminDashboard({ me, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const isRagTab = activeTab === 'rag';

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage />;
      case 'posts':
        return <PostsPage />;
      case 'users':
        return <UsersPage />;
      case 'reports':
        return <ReportsPage />;
      case 'toxic-language':
        return <ToxicLanguagePage />;
      case 'sentiment':
        return <SentimentPage />;
      case 'vision':
        return <VisionPage />;
      case 'overall':
        return <OverallAnalysisPage />;
      case 'rag':
        return <AdminRagChatPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="admin-dashboard">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="admin-main">
        <Header userName={me?.display_name} onLogout={onLogout} />
        
        <main className={`admin-content${isRagTab ? ' admin-content--no-scroll' : ''}`}>
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
