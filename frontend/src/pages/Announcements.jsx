import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../authContextValue';

export default function Announcements() {
  const { user } = useAuth();
  const canPost = user.role !== 'employee';

  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: '', body: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/comms/announcements');
      setItems(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load announcements');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/comms/announcements', form);
      setForm({ title: '', body: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post');
    }
  };

  return (
    <div>
      <h1>Announcements</h1>
      {canPost && (
        <form className="panel" onSubmit={post} style={{ maxWidth: 520 }}>
          <h3>Post announcement</h3>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea placeholder="Message" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          <button>Post</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p>No announcements yet</p>}
      {items.map((a) => (
        <div className="notice" key={a.id}>
          <b>{a.title}</b> <small>by {a.posted_by} on {new Date(a.created_at).toLocaleDateString()}</small>
          <div>{a.body}</div>
        </div>
      ))}
    </div>
  );
}