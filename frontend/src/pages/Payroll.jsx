import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../authContextValue';
import Table from '../components/Table';
import { downloadPayslip } from '../utils/download';

const money = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function Payroll() {
  const { user } = useAuth();
  const isHr = user.role === 'hr';
  const isAdmin = user.role === 'admin';

  const [runs, setRuns] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const { data } = await api.get('/payroll/runs');
      setRuns(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load payroll runs');
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const openRun = async (id) => {
    setError('');
    try {
      const { data } = await api.get(`/payroll/runs/${id}`);
      setSelected(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open run');
    }
  };

  const createDraft = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const { data } = await api.post('/payroll/runs', { month });
      setMessage(`Draft for ${month} saved (${data.payslips} payslips)`);
      await loadRuns();
      openRun(data.run.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create draft');
    } finally {
      setLoading(false);
    }
  };

  const finalize = async (id) => {
    if (!window.confirm('Finalize this payroll? It will be locked and cannot be edited.')) return;
    setError('');
    setMessage('');
    try {
      await api.post(`/payroll/runs/${id}/finalize`);
      setMessage('Payroll finalized and locked');
      await loadRuns();
      openRun(id);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to finalize');
    }
  };

  const handleDownload = async (slip) => {
    try {
      await downloadPayslip(slip.id, `payslip-${slip.code}-${selected.run.month}.pdf`);
    } catch {
      setError('Failed to download payslip');
    }
  };

  return (
    <div>
      <h1>Payroll</h1>

      {isHr && (
        <form className="row" onSubmit={createDraft}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          <button disabled={loading}>{loading ? 'Calculating...' : 'Create / refresh draft'}</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <Table
        columns={[
          { key: 'month', label: 'Month' },
          { key: 'status', label: 'Status' },
          { key: 'payslips', label: 'Payslips' },
          { key: 'total_gross', label: 'Total gross', render: (r) => money(r.total_gross) },
          { key: 'total_net', label: 'Total net', render: (r) => money(r.total_net) },
          {
            key: 'actions',
            label: '',
            render: (r) => (
              <div className="row" style={{ margin: 0 }}>
                <button className="secondary" onClick={() => openRun(r.id)}>View</button>
                {isAdmin && r.status === 'draft' && (
                  <button onClick={() => finalize(r.id)}>Finalize</button>
                )}
              </div>
            ),
          },
        ]}
        rows={runs}
        empty="No payroll runs yet"
      />

      {selected && (
        <div style={{ marginTop: 24 }}>
          <h2>
            Payslips for {selected.run.month} ({selected.run.status})
          </h2>
          <Table
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'full_name', label: 'Employee' },
              { key: 'department', label: 'Department', render: (r) => r.department || '-' },
              { key: 'gross', label: 'Gross', render: (r) => money(r.gross) },
              { key: 'deductions', label: 'Deductions', render: (r) => money(r.deductions) },
              { key: 'tax', label: 'Tax', render: (r) => money(r.tax) },
              { key: 'net', label: 'Net', render: (r) => money(r.net) },
              {
                key: 'pdf',
                label: '',
                render: (r) => <button className="secondary" onClick={() => handleDownload(r)}>PDF</button>,
              },
            ]}
            rows={selected.payslips}
          />
        </div>
      )}
    </div>
  );
}