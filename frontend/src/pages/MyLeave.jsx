import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';

const emptyForm = { leave_type_id: '', start_date: '', end_date: '', reason: '' };

export default function MyLeave() {
  const [balance, setBalance] = useState([]);
  const [requests, setRequests] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api.get('/leave/balance'), api.get('/leave')]);
      setBalance(b.data);
      setRequests(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load leave data');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const loadTypes = async () => {
      try {
        const { data } = await api.get('/org/leave-types');
        setTypes(data);
      } catch {
        setError('Failed to load leave types');
      }
    };
    loadTypes();
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const apply = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/leave', { ...form, leave_type_id: Number(form.leave_type_id) });
      setMessage('Leave request submitted');
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply');
    }
  };

  const cancel = async (id) => {
    if (!window.confirm('Cancel this leave request?')) return;
    setError('');
    try {
      await api.patch(`/leave/${id}/cancel`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel');
    }
  };

  return (
    <div>
      <h1>My leave</h1>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <Table
        columns={[
          { key: 'name', label: 'Type' },
          { key: 'yearly_quota', label: 'Quota', render: (r) => r.yearly_quota ?? 'Unlimited' },
          { key: 'used', label: 'Used' },
          { key: 'pending', label: 'Pending' },
          { key: 'remaining', label: 'Remaining', render: (r) => r.remaining ?? 'Unlimited' },
        ]}
        rows={balance.map((b) => ({ ...b, id: b.leave_type_id }))}
      />

      <form className="panel" onSubmit={apply} style={{ marginTop: 24 }}>
        <h3>Apply for leave</h3>
        <div className="row">
          <select name="leave_type_id" value={form.leave_type_id} onChange={handleChange} required>
            <option value="">Leave type</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input name="start_date" type="date" value={form.start_date} onChange={handleChange} required />
          <input name="end_date" type="date" value={form.end_date} onChange={handleChange} required />
          <input name="reason" placeholder="Reason" value={form.reason} onChange={handleChange} />
          <button>Submit</button>
        </div>
      </form>

      <h2>My requests</h2>
      <Table
        columns={[
          { key: 'leave_type', label: 'Type' },
          { key: 'start_date', label: 'From' },
          { key: 'end_date', label: 'To' },
          { key: 'days', label: 'Days' },
          { key: 'status', label: 'Status' },
          { key: 'hr_comment', label: 'HR comment', render: (r) => r.hr_comment || '-' },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              ['pending', 'approved'].includes(r.status) ? (
                <button className="danger" onClick={() => cancel(r.id)}>Cancel</button>
              ) : null,
          },
        ]}
        rows={requests}
        empty="No leave requests yet"
      />
    </div>
  );
}