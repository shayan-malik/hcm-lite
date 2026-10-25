import { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../api';
import { useAuth } from '../authContextValue';
import KpiCard from '../components/KpiCard';
import Table from '../components/Table';

const COLORS = ['#0f9d8a', '#5b4fcf', '#f59e0b', '#dc2626', '#0ea5e9'];
const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function Dashboard() {
  const { user } = useAuth();
  if (user.role === 'employee') return <EmployeeDashboard />;
  return <StaffDashboard role={user.role} />;
}

function Announcements({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3>Announcements</h3>
      {items.map((a) => (
        <div className="notice" key={a.id}>
          <b>{a.title}</b>
          <div>{a.body}</div>
        </div>
      ))}
    </div>
  );
}

function StaffDashboard({ role }) {
  const [filters, setFilters] = useState({ from: '', to: '', department_id: '' });
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = {
        from: filters.from || undefined,
        to: filters.to || undefined,
        department_id: filters.department_id || undefined,
      };
      const { data } = await api.get(`/dashboard/${role}`, { params });
      setData(data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dashboard');
    }
  }, [role, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const loadExtra = async () => {
      try {
        const [d, a] = await Promise.all([api.get('/org/departments'), api.get('/comms/announcements')]);
        setDepartments(d.data);
        setAnnouncements(a.data.slice(0, 3));
      } catch {
        setError('Failed to load filters');
      }
    };
    loadExtra();
  }, []);

  if (!data) return <p>{error || 'Loading...'}</p>;

  const set = (name) => (e) => setFilters({ ...filters, [name]: e.target.value });

  const summarize = async () => {
  setSummarizing(true);
  setSummary('');
  try {
    const { data } = await api.post('/ai/summary', {
      from: filters.from || undefined,
      to: filters.to || undefined,
      department_id: filters.department_id || undefined,
    });
    setSummary(`${data.summary}\n\n(${data.label})`);
  } catch (err) {
    setError(err.response?.data?.error || 'Summary unavailable');
  } finally {
    setSummarizing(false);
  }
};

  return (
    <div>
      <h1>{role === 'admin' ? 'Company dashboard' : 'HR dashboard'}</h1>
      {error && <p className="error">{error}</p>}

      <div className="row">
        <input type="date" value={filters.from} onChange={set('from')} title="From" />
        <input type="date" value={filters.to} onChange={set('to')} title="To" />
        <select value={filters.department_id} onChange={set('department_id')}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button onClick={summarize} disabled={summarizing}>
  {summarizing ? 'Summarizing...' : 'Summarize'}
</button>

{summary && <div className="summary-box">{summary}</div>}
      </div>

      {role === 'hr' ? <HrView data={data} /> : <AdminView data={data} />}
      <Announcements items={announcements} />
    </div>
  );
}

function HrView({ data }) {
  const k = data.kpis;
  const att = data.attendance;

  return (
    <div>
      <div className="kpis">
        <KpiCard label="Headcount" value={k.headcount} />
        <KpiCard label="Present today" value={k.presentToday} />
        <KpiCard label="On leave today" value={k.onLeaveToday} />
        <KpiCard label="Late today" value={k.lateToday} />
        <KpiCard label="Pending approvals" value={k.pendingApprovals} hint={`${k.pendingLeave} leave, ${k.pendingCorrections} corrections`} />
        <KpiCard label="Attendance rate" value={`${att.summary.attendanceRate}%`} hint="for selected range" />
        <KpiCard label="Late %" value={`${att.summary.latePercent}%`} />
      </div>

      <div className="charts">
        <div className="chart-box">
          <h3>Attendance trend (%)</h3>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={att.trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="attendanceRate" stroke="#0f9d8a" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Absenteeism by department (%)</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={att.byDepartment}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="department" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="absenteeismPercent" fill="#5b4fcf" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Approved leave days by type</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={data.leave.byType}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="leave_type" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="approved_days" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>Top 5 late-comers</h3>
      <Table
        columns={[
          { key: 'full_name', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'lates', label: 'Late days' },
        ]}
        rows={att.topLateComers.map((r) => ({ ...r, id: r.employee_id }))}
        empty="No late arrivals in this range"
      />
    </div>
  );
}

function AdminView({ data }) {
  const k = data.kpis;

  return (
    <div>
      <div className="kpis">
        <KpiCard label="Headcount" value={k.headcount} />
        <KpiCard label="Attrition YTD" value={`${k.attritionYtdPercent}%`} hint={`${k.exitsYtd} exits`} />
        <KpiCard label="Payroll cost (gross)" value={money(k.payrollCost.gross)} hint={k.payrollCost.month || 'No payroll yet'} />
        <KpiCard label="Payroll cost (net)" value={money(k.payrollCost.net)} />
        <KpiCard label="Average gross salary" value={money(k.averageGrossSalary)} />
      </div>

      <div className="charts">
        <div className="chart-box">
          <h3>Headcount by department</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={data.headcountByDepartment}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="department" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="headcount" fill="#0f9d8a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Payroll cost by month (gross vs net)</h3>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={monthTotals(data.payrollCostByMonthAndDepartment)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="gross" fill="#5b4fcf" />
              <Bar dataKey="net" fill="#0f9d8a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Gender split</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={data.genderSplit} dataKey="n" nameKey="gender" label>
                {data.genderSplit.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Tenure</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={data.tenureSplit} dataKey="n" nameKey="bucket" label>
                {data.tenureSplit.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>Average gross salary by department</h3>
      <Table
        columns={[
          { key: 'department', label: 'Department' },
          { key: 'avg_gross', label: 'Average gross', render: (r) => money(r.avg_gross) },
        ]}
        rows={data.averageGrossByDepartment.map((r) => ({ ...r, id: r.department }))}
      />

      <h3 style={{ marginTop: 20 }}>Recent activity</h3>
      <Table
        columns={[
          { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString() },
          { key: 'actor', label: 'Actor', render: (r) => r.actor || '-' },
          { key: 'action', label: 'Action' },
          { key: 'entity', label: 'Entity' },
        ]}
        rows={data.auditFeed}
        empty="No activity yet"
      />
    </div>
  );
}

// Sums payroll rows of all departments into one row per month
function monthTotals(rows) {
  const map = {};
  for (const r of rows) {
    map[r.month] = map[r.month] || { month: r.month, gross: 0, net: 0 };
    map[r.month].gross += r.gross;
    map[r.month].net += r.net;
  }
  return Object.values(map);
}

function EmployeeDashboard() {
  const [data, setData] = useState(null);
  const [today, setToday] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([api.get('/dashboard/employee'), api.get('/attendance/today')]);
      setData(d.data);
      setToday(t.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (path) => {
    setError('');
    try {
      await api.post(`/attendance/${path}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
  };

  if (!data) return <p>{error || 'Loading...'}</p>;

  return (
    <div>
      <h1>My dashboard</h1>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <h3>Check-in</h3>
        <p>Today: <b>{today ? today.status : 'Not checked in'}</b></p>
        <div className="row">
          <button disabled={!!today} onClick={() => act('check-in')}>Check in</button>
          <button className="secondary" disabled={!today || !!today.check_out} onClick={() => act('check-out')}>Check out</button>
        </div>
      </div>

      <div className="kpis">
        <KpiCard label="Hours this week" value={`${data.hoursThisWeek} / ${data.weeklyTarget}`} />
        <KpiCard label="Late count (month)" value={data.lateCountThisMonth} />
        {data.leaveBalance.map((b) => (
          <KpiCard key={b.leave_type_id} label={`${b.name} leave left`} value={b.remaining ?? 'Unlimited'} />
        ))}
        <KpiCard
          label="Last payslip"
          value={data.lastPayslip ? money(data.lastPayslip.net) : '-'}
          hint={data.lastPayslip?.month || 'None yet'}
        />
      </div>

      <Announcements items={data.announcements} />
    </div>
  );
}