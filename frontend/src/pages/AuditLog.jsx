import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const limit = 20;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/comms/audit', { params: { page, limit } });
      setRows(data.data);
      setTotal(data.total);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit log');
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <h1>Audit log</h1>
      {error && <p className="error">{error}</p>}
      <Table
        columns={[
          { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString() },
          { key: 'actor', label: 'Actor', render: (r) => r.actor || '-' },
          { key: 'action', label: 'Action' },
          { key: 'entity', label: 'Entity' },
          { key: 'entity_id', label: 'ID' },
          {
            key: 'changes',
            label: 'Before → After',
            render: (r) => (
              <details>
                <summary>View</summary>
                <pre style={{ fontSize: 11, maxWidth: 360 }}>{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 1)}</pre>
              </details>
            ),
          },
        ]}
        rows={rows}
        empty="No audit entries yet"
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button className="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}