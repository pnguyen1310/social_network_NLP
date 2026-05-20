import React from 'react';
import './StatsCard.css';

export default function StatsCard({ icon: Icon, label, value, trend, color = 'blue' }) {
  return (
    <div className={`stats-card stats-${color}`}>
      <div className="card-header">
        <div className="card-icon">
          <Icon size={24} />
        </div>
        <div className="card-label">{label}</div>
      </div>

      <div className="card-body">
        <div className="card-value">{value || '—'}</div>
        {trend && (
          <div className={`card-trend trend-${trend > 0 ? 'up' : 'down'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </div>
        )}
      </div>
    </div>
  );
}
