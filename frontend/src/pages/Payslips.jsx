import { useEffect, useState } from 'react';
import api from '../api';
import Table from '../components/Table';
import { downloadPayslip } from '../utils/download';

const money = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Payslips() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/payroll/payslips/my');
        setRows(data);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load payslips');
      }
    };
    load();
  }, []);

  const handleDownload = async (slip) => {
    try {
      await downloadPayslip(slip.id, `payslip-${slip.month}.pdf`);
    } catch {
      setError('Failed to download payslip');
    }
  };

  return (
    <div>
      <h1>Payslips</h1>
      {error && <p className="error">{error}</p>}
      <Table
        columns={[
          { key: 'month', label: 'Month' },
          { key: 'gross', label: 'Gross', render: (r) => money(r.gross) },
          { key: 'deductions', label: 'Deductions', render: (r) => money(r.deductions) },
          { key: 'tax', label: 'Tax', render: (r) => money(r.tax) },
          { key: 'net', label: 'Net', render: (r) => money(r.net) },
          { key: 'pdf', label: '', render: (r) => <button onClick={() => handleDownload(r)}>Download PDF</button> },
        ]}
        rows={rows}
        empty="No payslips yet. They appear after Admin finalizes payroll."
      />
    </div>
  );
}