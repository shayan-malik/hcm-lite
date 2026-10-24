import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Setup() {
  const [form, setForm] = useState({ companyName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/setup', form);
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card" onSubmit={handleSubmit}>
        <h2>Welcome to HCM Lite</h2>
        <p>Create your company and the Admin account.</p>
        <input name="companyName" placeholder="Company name" value={form.companyName} onChange={handleChange} required />
        <input name="email" type="email" placeholder="Admin email" value={form.email} onChange={handleChange} required />
        <input name="password" type="password" placeholder="Password (min 6 chars)" value={form.password} onChange={handleChange} required />
        {error && <p className="error">{error}</p>}
        <button disabled={loading}>{loading ? 'Creating...' : 'Complete setup'}</button>
      </form>
    </div>
  );
}