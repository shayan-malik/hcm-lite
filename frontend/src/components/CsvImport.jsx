import { useState } from 'react';
import api from '../api';
import Table from './Table';

const TEMPLATE =
  'code,full_name,email,phone,gender,department,designation,join_date,basic_salary\n' +
  'EMP-100,Sample Person,sample@smxcreators.com,03001234567,Male,Development,Software Engineer,2026-10-01,90000\n';

export default function CsvImport({ onImported }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setReport(null);
    setCredentials(null);
    setError('');
  };

  const run = async (dryRun) => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(`/employees/import${dryRun ? '?dryRun=true' : ''}`, { csv });
      if (dryRun) {
        setReport(data);
      } else {
        setCredentials(data.credentials);
        setReport(null);
        setCsv('');
        setFileName('');
        onImported();
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) setReport({ dryRun: true, total: 0, valid: 0, errors: data.errors });
      setError(data?.error || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = window.URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'employees-template.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="panel">
      <h3>Import employees from CSV</h3>
      <div className="row">
        <input type="file" accept=".csv,text/csv" onChange={handleFile} />
        <button className="secondary" type="button" onClick={downloadTemplate}>Download template</button>
      </div>
      {fileName && (
        <div className="row">
          <span>{fileName}</span>
          <button type="button" disabled={busy} onClick={() => run(true)}>Dry run (check only)</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {report && (
        <div>
          <p>
            Rows: <b>{report.total}</b> | Valid: <b>{report.valid}</b> | Errors: <b>{report.errors.length}</b>
          </p>
          {report.errors.length > 0 ? (
            <Table
              columns={[
                { key: 'row', label: 'Row' },
                { key: 'field', label: 'Field' },
                { key: 'reason', label: 'Reason' },
              ]}
              rows={report.errors.map((e, i) => ({ ...e, id: i }))}
            />
          ) : (
            <button disabled={busy} onClick={() => run(false)}>Import {report.valid} employees</button>
          )}
        </div>
      )}

      {credentials && (
        <div>
          <p className="success">Imported. Share these temporary passwords now (shown only once):</p>
          <Table
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'email', label: 'Email' },
              { key: 'tempPassword', label: 'Temporary password' },
            ]}
            rows={credentials.map((c, i) => ({ ...c, id: i }))}
          />
        </div>
      )}
    </div>
  );
}