import React from 'react';
import './DataTable.css';
import { Trash2, Eye } from 'lucide-react';

export default function DataTable({ title, columns, data, onView, onDelete, loading, empty }) {
  const hasActions = Boolean(onView || onDelete);

  return (
    <div className="data-table">
      <div className="table-header">
        <h3>{title}</h3>
      </div>

      {loading ? (
        <div className="table-loading">Đang tải dữ liệu...</div>
      ) : data && data.length === 0 ? (
        <div className="table-empty">{empty || 'Không có dữ liệu'}</div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} style={{ width: col.width }}>
                    {col.label}
                  </th>
                ))}
                {hasActions && <th>Hành động</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={row.id || idx}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="actions">
                      {onView && (
                        <button className="btn-icon view" onClick={() => onView(row)} title="Xem">
                          <Eye size={16} />
                        </button>
                      )}
                      {onDelete && (
                        <button className="btn-icon delete" onClick={() => onDelete(row.id)} title="Xóa">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
