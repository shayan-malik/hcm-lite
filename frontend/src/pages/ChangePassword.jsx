import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../authContextValue'; 
export default function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { passwordChanged } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/change-password', form);
      passwordChanged();
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card" onSubmit={handleSubmit}>
        <h2>Change your password</h2>
        <input name="currentPassword" type="password" placeholder="Current (temporary) password" value={form.currentPassword} onChange={handleChange} required />
        <input name="newPassword" type="password" placeholder="New password (min 6 chars)" value={form.newPassword} onChange={handleChange} required />
        {error && <p className="error">{error}</p>}
        <button disabled={loading}>{loading ? 'Saving...' : 'Change password'}</button>
      </form>
    </div>
  );
}