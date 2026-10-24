import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';

export default function Users() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ email: '', tempPassword: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
  try {
    const { data } = await api.get('/users');
    setRows(data);
  } catch (err) {
    setError(err.response?.data?.error || 'Failed to load users');
  }
}, []);

useEffect(() => {
  load();
}, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/users/hr', form);
      setMessage(`HR login created for ${form.email}`);
      setForm({ email: '', tempPassword: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create HR login');
    }
  };

  const toggleActive = async (user) => {
    setError('');
    try {
      await api.patch(`/users/${user.id}/active`, { isActive: !user.is_active });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    }
  };

  const resetPassword = async (user) => {
    const tempPassword = window.prompt(`New temporary password for ${user.email} (min 6 chars):`);
    if (!tempPassword) return;
    setError('');
    setMessage('');
    try {
      await api.post(`/users/${user.id}/reset-password`, { tempPassword });
      setMessage(`Password reset for ${user.email}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset');
    }
  };

  return (
    <div>
      <h1>Users</h1>
      <form className="row" onSubmit={handleCreate}>
        <input type="email" placeholder="HR email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Temporary password" value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} required />
        <button>Create HR login</button>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <Table
        columns={[
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Role' },
          { key: 'is_active', label: 'Status', render: (r) => (r.is_active ? 'Active' : 'Deactivated') },
          {
            key: 'actions',
            label: 'Actions',
            render: (r) => (
              <div className="row" style={{ margin: 0 }}>
                <button className="secondary" onClick={() => toggleActive(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>
                <button onClick={() => resetPassword(r)}>Reset password</button>
              </div>
            ),
          },
        ]}
        rows={rows}
      />
    </div>
  );
}