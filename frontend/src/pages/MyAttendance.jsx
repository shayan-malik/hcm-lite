import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';

const time = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

export default function MyAttendance() {
  const [today, setToday] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [days, setDays] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [form, setForm] = useState({ date: '', check_in: '09:00', check_out: '17:00', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadToday = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance/today');
      setToday(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load today');
    }
  }, []);

  const loadMonth = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance/my', { params: { month } });
      setDays(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load calendar');
    }
  }, [month]);

  const loadCorrections = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance/corrections');
      setCorrections(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load corrections');
    }
  }, []);

  useEffect(() => {
    loadToday();
    loadCorrections();
  }, [loadToday, loadCorrections]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const act = async (path) => {
    setError('');
    setMessage('');
    try {
      await api.post(`/attendance/${path}`);
      await loadToday();
      loadMonth();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
  };

  const submitCorrection = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/attendance/corrections', form);
      setMessage('Correction request sent to HR');
      setForm({ date: '', check_in: '09:00', check_out: '17:00', reason: '' });
      loadCorrections();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send request');
    }
  };

  return (
    <div>
      <h1>My attendance</h1>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="panel">
        <h3>Today</h3>
        <p>
          Status: <b>{today ? today.status : 'Not checked in'}</b> | In: {time(today?.check_in)} | Out: {time(today?.check_out)}
        </p>
        <div className="row">
          <button disabled={!!today} onClick={() => act('check-in')}>Check in</button>
          <button className="secondary" disabled={!today || !!today.check_out} onClick={() => act('check-out')}>
            Check out
          </button>
        </div>
      </div>

      <div className="row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <Table
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'status', label: 'Status' },
          { key: 'check_in', label: 'Check in', render: (r) => time(r.check_in) },
          { key: 'check_out', label: 'Check out', render: (r) => time(r.check_out) },
        ]}
        rows={days.map((d) => ({ ...d, id: d.date }))}
        empty="No days to show for this month"
      />

      <form className="panel" onSubmit={submitCorrection} style={{ marginTop: 24 }}>
        <h3>Request a correction</h3>
        <div className="row">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <input type="time" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} required />
          <input type="time" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} required />
          <input placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <button>Send request</button>
        </div>
      </form>

      <h2>My correction requests</h2>
      <Table
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status' },
        ]}
        rows={corrections}
        empty="No correction requests"
      />
    </div>
  );
}