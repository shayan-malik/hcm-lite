import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../authContextValue';
import Table from '../components/Table';

const time = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

export default function Attendance() {
  const { user } = useAuth();
  const isHr = user.role === 'hr';

  const [date, setDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [board, setBoard] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [error, setError] = useState('');

  const loadBoard = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance/board', {
        params: { date: date || undefined, department_id: departmentId || undefined },
      });
      setBoard(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load board');
    }
  }, [date, departmentId]);

  const loadCorrections = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance/corrections');
      setCorrections(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load corrections');
    }
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    loadCorrections();
  }, [loadCorrections]);

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const { data } = await api.get('/org/departments');
        setDepartments(data);
      } catch {
        setError('Failed to load departments');
      }
    };
    loadDepartments();
  }, []);

  const decide = async (id, decision) => {
    setError('');
    try {
      await api.patch(`/attendance/corrections/${id}`, { decision });
      loadCorrections();
      loadBoard();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    }
  };

  return (
    <div>
      <h1>Attendance</h1>
      {error && <p className="error">{error}</p>}

      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <Table
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'full_name', label: 'Name' },
          { key: 'department', label: 'Department', render: (r) => r.department || '-' },
          { key: 'status', label: 'Status' },
          { key: 'check_in', label: 'Check in', render: (r) => time(r.check_in) },
          { key: 'check_out', label: 'Check out', render: (r) => time(r.check_out) },
        ]}
        rows={board}
        empty="No employees for this date"
      />

      <h2 style={{ marginTop: 28 }}>Correction requests</h2>
      <Table
        columns={[
          { key: 'full_name', label: 'Employee' },
          { key: 'date', label: 'Date' },
          { key: 'ci', label: 'Requested in', render: (r) => String(r.requested_check_in).slice(0, 5) },
          { key: 'co', label: 'Requested out', render: (r) => String(r.requested_check_out).slice(0, 5) },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status' },
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
        rows={corrections}
        empty="No correction requests"
      />
    </div>
  );
}