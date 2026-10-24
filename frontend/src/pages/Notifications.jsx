import { useCallback, useEffect, useState } from 'react';
import api from '../api';

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/comms/notifications');
      setItems(data.data);
      setUnread(data.unread);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load notifications');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    try {
      await api.post('/comms/notifications/read-all');
      load();
    } catch {
      setError('Failed to update');
    }
  };

  return (
    <div>
      <h1>Notifications ({unread} unread)</h1>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="secondary" onClick={markAll}>Mark all as read</button>
      </div>
      {items.length === 0 && <p>No notifications yet</p>}
      {items.map((n) => (
        <div className="notice" key={n.id} style={{ opacity: n.is_read ? 0.6 : 1 }}>
          {n.message}
          <div><small>{new Date(n.created_at).toLocaleString()}</small></div>
        </div>
      ))}
    </div>
  );
}