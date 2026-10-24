import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../authContextValue';
import Table from '../components/Table';

export default function LeaveInbox() {
  const { user } = useAuth();
  const isHr = user.role === 'hr';

  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/leave', { params: { status: status || undefined } });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load leave requests');
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, decision) => {
    const comment = window.prompt(
      decision === 'rejected' ? 'Reason for rejection (required):' : 'Comment (optional):'
    );
    if (comment === null) return;
    setError('');
    try {
      await api.patch(`/leave/${id}/decision`, { decision, comment: comment || undefined });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    }
  };

  return (
    <div>
      <h1>Leave requests</h1>
      {error && <p className="error">{error}</p>}

      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
          <option value="">All</option>
        </select>
      </div>

      <Table
        columns={[
          { key: 'full_name', label: 'Employee' },
          { key: 'leave_type', label: 'Type' },
          { key: 'start_date', label: 'From' },
          { key: 'end_date', label: 'To' },
          { key: 'days', label: 'Days' },
          { key: 'reason', label: 'Reason', render: (r) => r.reason || '-' },
          { key: 'status', label: 'Status' },
          { key: 'hr_comment', label: 'HR comment', render: (r) => r.hr_comment || '-' },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              isHr && r.status === 'pending' ? (
                <div className="row" style={{ margin: 0 }}>
                  <button onClick={() => decide(r.id, 'approved')}>Approve</button>
                  <button className="danger" onClick={() => decide(r.id, 'rejected')}>Reject</button>
                </div>
              ) : null,
          },
        ]}
        rows={rows}
        empty="No leave requests"
      />
    </div>
  );
}