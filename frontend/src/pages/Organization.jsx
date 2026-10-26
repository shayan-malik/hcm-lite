import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';

const TABS = ['Settings', 'Departments', 'Designations', 'Leave types', 'Holidays'];

export default function Organization() {
  const [tab, setTab] = useState('Settings');

  return (
    <div>
      <h1>Organization</h1>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Settings' && <SettingsTab />}
      {tab === 'Departments' && <NameTab path="/org/departments" label="Department" />}
      {tab === 'Designations' && <NameTab path="/org/designations" label="Designation" />}
      {tab === 'Leave types' && <LeaveTypesTab />}
      {tab === 'Holidays' && <HolidaysTab />}
    </div>
  );
}

function SettingsTab() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/org/settings');
        setForm({
          ...data,
          office_start: (data.office_start || '09:00').slice(0, 5),
          office_lat: data.office_lat ?? '',
          office_lng: data.office_lng ?? '',
        });
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load settings');
      }
    };
    load();
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.put('/org/settings', {
        company_name: form.company_name,
        office_start: form.office_start,
        grace_minutes: Number(form.grace_minutes),
        half_day_hours: Number(form.half_day_hours),
        weekend_days: form.weekend_days,
        office_lat: form.office_lat === '' ? null : Number(form.office_lat),
        office_lng: form.office_lng === '' ? null : Number(form.office_lng),
        radius_m: Number(form.radius_m),
      });
      setMessage('Settings saved');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  if (!form) return <p>{error || 'Loading...'}</p>;

  return (
    <form className="panel stack" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      <h3>Company settings</h3>
      <label>Company name</label>
      <input name="company_name" value={form.company_name || ''} onChange={handleChange} />
      <label>Office start time</label>
      <input name="office_start" type="time" value={form.office_start} onChange={handleChange} />
      <label>Grace time (minutes)</label>
      <input name="grace_minutes" type="number" value={form.grace_minutes} onChange={handleChange} />
      <label>Half day under (hours)</label>
      <input name="half_day_hours" type="number" value={form.half_day_hours} onChange={handleChange} />
      <label>Weekend days (e.g. Sat,Sun)</label>
      <input name="weekend_days" value={form.weekend_days} onChange={handleChange} />
      <label>Office latitude</label>
      <input name="office_lat" type="number" step="any" value={form.office_lat} onChange={handleChange} />
      <label>Office longitude</label>
      <input name="office_lng" type="number" step="any" value={form.office_lng} onChange={handleChange} />
      <label>Radius (meters)</label>
      <input name="radius_m" type="number" value={form.radius_m} onChange={handleChange} />
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <button>Save settings</button>
    </form>
  );
}

function NameTab({ path, label }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
  try {
    const { data } = await api.get(path);
    setRows(data);
  } catch (err) {
    setError(err.response?.data?.error || 'Failed to load');
  }
}, [path]);

useEffect(() => {
  load();
}, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(path, { name });
      setName('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add');
    }
  };

  return (
    <div>
      <form className="row" onSubmit={handleAdd}>
        <input placeholder={`New ${label.toLowerCase()} name`} value={name} onChange={(e) => setName(e.target.value)} required />
        <button>Add {label.toLowerCase()}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <Table columns={[{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }]} rows={rows} empty={`No ${label.toLowerCase()}s yet`} />
    </div>
  );
}

function LeaveTypesTab() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: '', yearly_quota: '', is_paid: true });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
  try {
    const { data } = await api.get('/org/leave-types');
    setRows(data);
  } catch (err) {
    setError(err.response?.data?.error || 'Failed to load');
  }
}, []);

useEffect(() => {
  load();
}, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/org/leave-types', {
        name: form.name,
        yearly_quota: form.yearly_quota === '' ? null : Number(form.yearly_quota),
        is_paid: form.is_paid,
      });
      setForm({ name: '', yearly_quota: '', is_paid: true });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add');
    }
  };

  return (
    <div>
      <form className="row" onSubmit={handleAdd}>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder="Yearly quota (empty = unlimited)" type="number" value={form.yearly_quota} onChange={(e) => setForm({ ...form, yearly_quota: e.target.value })} />
        <label>
          <input type="checkbox" checked={form.is_paid} onChange={(e) => setForm({ ...form, is_paid: e.target.checked })} /> Paid
        </label>
        <button>Add leave type</button>
      </form>
      {error && <p className="error">{error}</p>}
      <Table
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'yearly_quota', label: 'Yearly quota', render: (r) => r.yearly_quota ?? 'Unlimited' },
          { key: 'is_paid', label: 'Paid', render: (r) => (r.is_paid ? 'Yes' : 'No') },
        ]}
        rows={rows}
      />
    </div>
  );
}

function HolidaysTab() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
  try {
    const { data } = await api.get('/org/holidays');
    setRows(data);
  } catch (err) {
    setError(err.response?.data?.error || 'Failed to load');
  }
}, []);

useEffect(() => {
  load();
}, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/org/holidays', form);
      setForm({ date: '', name: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/org/holidays/${id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div>
      <form className="row" onSubmit={handleAdd}>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input placeholder="Holiday name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <button>Add holiday</button>
      </form>
      {error && <p className="error">{error}</p>}
      <Table
        columns={[
          { key: 'date', label: 'Date', render: (r) => String(r.date).slice(0, 10) },
          { key: 'name', label: 'Name' },
          { key: 'action', label: '', render: (r) => <button className="danger" onClick={() => handleDelete(r.id)}>Delete</button> },
        ]}
        rows={rows}
      />
    </div>
  );
}