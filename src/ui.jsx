import React from 'react';

export const panelStyle = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 16,
  marginBottom: 20
};

export const gridStyle = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  alignItems: 'end',
  marginBottom: 12
};

export const tableStyle = { width: '100%', borderCollapse: 'collapse' };

export function Panel({ title, children }) {
  return (
    <section aria-label={title} style={panelStyle}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p role="alert" style={{ color: '#b00020', margin: '8px 0' }}>{children}</p>;
}

export function DataTable({ columns, rows, emptyText }) {
  return (
    <table style={tableStyle} cellPadding="8">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} align={column.align || 'left'}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id || index} style={{ borderTop: '1px solid #ddd' }}>
            {columns.map((column) => (
              <td key={column.key} align={column.align || 'left'}>
                {column.render ? column.render(row) : row[column.key]}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} style={{ color: '#666' }}>{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
