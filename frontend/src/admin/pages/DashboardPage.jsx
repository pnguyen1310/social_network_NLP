import React, { useEffect, useState } from 'react';
import StatsCard from '../components/cards/StatsCard';
import DataTable from '../components/cards/DataTable';
import { Users, FileText, MessageSquare } from 'lucide-react';
import { Pie, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import '../pages/DashboardPage.css';
import { admin as api } from '../api';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000';

function getMediaUrl(raw) {
  if (!raw) return null;
  if (String(raw).startsWith('http://') || String(raw).startsWith('https://')) return raw;
  return `${API_BASE}${raw}`;
}

function renderPostSummary(v, row) {
  if ((row.media_type === 'image' || row.media_type === 'video') && row.media_url) {
    const src = getMediaUrl(row.media_url);
    const isVideo = row.media_type === 'video';
    const title = isVideo ? 'Bài đăng video' : 'Bài đăng ảnh';
    const fallbackText = isVideo ? 'Video không có mô tả' : 'Ảnh không có mô tả';
    
    return (
      <div className="dashboard-post-inline">
        {isVideo ? (
          <video className="dashboard-post-thumb dashboard-post-video" src={src} muted />
        ) : (
          <img className="dashboard-post-thumb" src={src} alt="Ảnh bài viết" />
        )}
        <div className="dashboard-post-copy">
          <div className="dashboard-post-title">{title}</div>
          <div className="dashboard-post-text">
            {v ? v.slice(0, 70) + (v.length > 70 ? '…' : '') : fallbackText}
          </div>
        </div>
      </div>
    );
  }

  return v ? v.slice(0, 60) + (v.length > 60 ? '…' : '') : '(bài viết không có nội dung)';
}

function normalizeSentimentGroup(label) {
  const key = String(label || '').trim().toUpperCase();
  if (['POS', 'POSITIVE', 'ENJOYMENT'].includes(key)) return 'positive';
  if (['NEU', 'NEUTRAL', 'OTHER', 'SURPRISE'].includes(key)) return 'neutral';
  if (['NEG', 'NEGATIVE', 'ANGER', 'DISGUST', 'FEAR', 'SADNESS'].includes(key)) return 'negative';
  return null;
}

function calcAgeFromDob(dobIso) {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  if (age < 0 || age > 120) return null;
  return age;
}

function ageBucket(age) {
  if (age == null) return 'Chưa rõ';
  if (age < 18) return '<18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  return '45+';
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [sentimentData, setSentimentData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    loadSentimentData();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.stats();
      setStats(data);
    } catch (e) {
      console.warn('Load stats failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadSentimentData = async () => {
    try {
      const data = await api.overallPosts({ limit: 100, background: true });
      setSentimentData(data);
    } catch (e) {
      console.warn('Load sentiment data failed:', e);
    }
  };

  const totals = stats?.totals || {};
  const topCommented = stats?.top_commented || [];
  const topLiked = stats?.top_liked || [];
  const sentimentSummary = sentimentData?.summary || {};
  const labelCounts = sentimentSummary.label_counts || {};
  const sentimentItems = Array.isArray(sentimentData?.items) ? sentimentData.items : [];
  
  // Calculate sentiment totals from label_counts
  const sentimentTotals = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  
  Object.entries(labelCounts).forEach(([label, count]) => {
    const key = String(label).trim().toUpperCase();
    if (['POS', 'POSITIVE', 'ENJOYMENT'].includes(key)) {
      sentimentTotals.positive += count;
    } else if (['NEU', 'NEUTRAL', 'OTHER', 'SURPRISE'].includes(key)) {
      sentimentTotals.neutral += count;
    } else if (['NEG', 'NEGATIVE', 'ANGER', 'DISGUST', 'FEAR', 'SADNESS'].includes(key)) {
      sentimentTotals.negative += count;
    }
  });

  const ageLabels = ['<18', '18-24', '25-34', '35-44', '45+', 'Chưa rõ'];
  const ageSentimentMatrix = ageLabels.reduce((acc, bucket) => {
    acc[bucket] = { positive: 0, neutral: 0, negative: 0 };
    return acc;
  }, {});

  sentimentItems.forEach((item) => {
    const group = normalizeSentimentGroup(
      item?.overall_sentiment_label || item?.model_sentiment_label || item?.sentiment_label
    );
    if (!group) return;
    const age = calcAgeFromDob(item?.author?.date_of_birth);
    const bucket = ageBucket(age);
    ageSentimentMatrix[bucket][group] += 1;
  });

  const hasAgeSentimentData = ageLabels.some(
    (bucket) =>
      ageSentimentMatrix[bucket].positive > 0 ||
      ageSentimentMatrix[bucket].neutral > 0 ||
      ageSentimentMatrix[bucket].negative > 0
  );
  
  return (
    <div className="dashboard-page">
      <div className="dashboard-grid">
        {/* Stats Cards */}
        <StatsCard
          icon={Users}
          label="Tổng người dùng"
          value={totals.users}
          color="blue"
        />
        <StatsCard
          icon={FileText}
          label="Tổng bài viết"
          value={totals.posts}
          color="green"
        />
        <StatsCard
          icon={MessageSquare}
          label="Tổng bình luận"
          value={totals.comments}
          color="purple"
        />
      </div>

      <div className="sentiment-chart-container">
        <div className="chart-card">
          <h3>Phân bố cảm xúc</h3>
          {sentimentTotals.positive > 0 || sentimentTotals.neutral > 0 || sentimentTotals.negative > 0 ? (
            <Pie
              data={{
                labels: ['Tích cực', 'Trung tính', 'Tiêu cực'],
                datasets: [
                  {
                    data: [sentimentTotals.positive, sentimentTotals.neutral, sentimentTotals.negative],
                    backgroundColor: [
                      '#22c55e', // green for positive
                      '#3b82f6', // blue for neutral
                      '#f97316', // orange for negative
                    ],
                    borderColor: [
                      '#16a34a',
                      '#1d4ed8',
                      '#c2410c',
                    ],
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: {
                      font: { size: 12 },
                      padding: 15,
                      usePointStyle: true,
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        const label = context.label || '';
                        const value = context.parsed || 0;
                        const total = context.dataset.data.reduce((a, b) => a + b, 0) || 1;
                        const percent = ((value / total) * 100).toFixed(1);
                        return `${label}: ${value} (${percent}%)`;
                      },
                    },
                  },
                },
              }}
            />
          ) : (
            <div className="chart-empty">Chưa có dữ liệu phân tích cảm xúc</div>
          )}
        </div>

        <div className="chart-card">
          <h3>Thống kê cảm xúc</h3>
          {sentimentTotals.positive > 0 || sentimentTotals.neutral > 0 || sentimentTotals.negative > 0 ? (
            <Bar
              data={{
                labels: ['Tích cực', 'Trung tính', 'Tiêu cực'],
                datasets: [
                  {
                    label: 'Số bài viết',
                    data: [sentimentTotals.positive, sentimentTotals.neutral, sentimentTotals.negative],
                    backgroundColor: [
                      '#22c55e',
                      '#3b82f6',
                      '#f97316',
                    ],
                    borderColor: [
                      '#16a34a',
                      '#1d4ed8',
                      '#c2410c',
                    ],
                    borderWidth: 1,
                    borderRadius: 6,
                  },
                ],
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                  legend: {
                    display: false,
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => {
                        return `${context.parsed.x} bài viết`;
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    ticks: {
                      stepSize: 1,
                    },
                  },
                },
              }}
            />
          ) : (
            <div className="chart-empty">Chưa có dữ liệu phân tích cảm xúc</div>
          )}
        </div>
      </div>

      <div className="chart-card age-chart-card">
        <h3>Phân bố cảm xúc theo độ tuổi</h3>
        {hasAgeSentimentData ? (
          <Bar
            data={{
              labels: ageLabels,
              datasets: [
                {
                  label: 'Tích cực',
                  data: ageLabels.map((bucket) => ageSentimentMatrix[bucket].positive),
                  backgroundColor: '#22c55e',
                },
                {
                  label: 'Trung tính',
                  data: ageLabels.map((bucket) => ageSentimentMatrix[bucket].neutral),
                  backgroundColor: '#3b82f6',
                },
                {
                  label: 'Tiêu cực',
                  data: ageLabels.map((bucket) => ageSentimentMatrix[bucket].negative),
                  backgroundColor: '#f97316',
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: true,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: {
                    usePointStyle: true,
                    padding: 14,
                  },
                },
                tooltip: {
                  callbacks: {
                    label: (context) => `${context.dataset.label}: ${context.parsed.y} bài viết`,
                  },
                },
              },
              scales: {
                x: {
                  stacked: true,
                },
                y: {
                  stacked: true,
                  beginAtZero: true,
                  ticks: {
                    stepSize: 1,
                  },
                },
              },
            }}
          />
        ) : (
          <div className="chart-empty">Chưa đủ dữ liệu tuổi để phân tích phân bố cảm xúc</div>
        )}
      </div>

      <div className="dashboard-charts">
        <DataTable
          title="Bài viết được bình luận nhiều nhất"
          columns={[
            { key: 'id', label: 'ID', width: '60px' },
            { key: 'content', label: 'Nội dung', render: (v, row) => renderPostSummary(v, row) },
            { key: 'comments', label: 'Bình luận', width: '100px', render: (v) => v || 0 },
          ]}
          data={topCommented}
          loading={loading}
          empty="Chưa có dữ liệu"
        />

        <DataTable
          title="Bài viết được thích nhiều nhất"
          columns={[
            { key: 'id', label: 'ID', width: '60px' },
            { key: 'content', label: 'Nội dung', render: (v, row) => renderPostSummary(v, row) },
            { key: 'likes', label: 'Thích', width: '100px', render: (v) => v || 0 },
          ]}
          data={topLiked}
          loading={loading}
          empty="Chưa có dữ liệu"
        />
      </div>
    </div>
  );
}
