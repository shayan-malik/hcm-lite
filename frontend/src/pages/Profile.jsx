import { useEffect, useState } from 'react';
import api from '../api';

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ phone: '', address: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/employees/me');
        setProfile(data);
        setForm({ phone: data.phone || '', address: data.address || '' });
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load profile');
      }
    };
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.patch('/employees/me', form);
      setMessage('Profile updated');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    }
  };

  if (!profile) return <p>{error || 'Loading...'}</p>;

  return (
    <div>
      <h1>My profile</h1>
      <div className="panel">
        <p><b>{profile.full_name}</b> ({profile.code})</p>
        <p>Email: {profile.email}</p>
        <p>Department: {profile.department || '-'} | Designation: {profile.designation || '-'}</p>
        <p>Joined: {String(profile.join_date).slice(0, 10)} | Status: {profile.status}</p>
      </div>
      <form className="panel" onSubmit={save} style={{ maxWidth: 480 }}>
        <h3>Edit contact details</h3>
        <label>Phone</label>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <label>Address</label>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        <button>Save</button>
      </form>
    </div>
  );
}