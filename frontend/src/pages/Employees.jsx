import { useCallback, useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "../authContextValue";
import Table from "../components/Table";
import CsvImport from "../components/CsvImport";
import { downloadEmployeesCsv } from "../utils/download";

const emptyForm = {
  full_name: "",
  email: "",
  phone: "",
  gender: "",
  department_id: "",
  designation_id: "",
  join_date: "",
  basic_salary: "",
};

export default function Employees() {
  const { user } = useAuth();
  const isHr = user.role === "hr";

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const limit = 10;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/employees", {
        params: {
          q: q || undefined,
          department_id: departmentId || undefined,
          page,
          limit,
        },
      });
      setRows(data.data);
      setTotal(data.total);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load employees");
    }
  }, [q, departmentId, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const loadLists = async () => {
      try {
        const [d, g] = await Promise.all([
          api.get("/org/departments"),
          api.get("/org/designations"),
        ]);
        setDepartments(d.data);
        setDesignations(g.data);
      } catch {
        setError("Failed to load departments");
      }
    };
    loadLists();
  }, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setCreated(null);
    try {
      const { data } = await api.post("/employees", {
        ...form,
        department_id: form.department_id || null,
        designation_id: form.designation_id || null,
        basic_salary: Number(form.basic_salary),
      });
      setCreated({
        email: data.employee.email,
        tempPassword: data.tempPassword,
      });
      setForm(emptyForm);
      setPage(1);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to register employee");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <h1>Employees</h1>

      {isHr && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>Register employee</h3>
          <div className="row">
            <input
              name="full_name"
              placeholder="Full name"
              value={form.full_name}
              onChange={handleChange}
              required
            />
            <input
              name="email"
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={handleChange}
              required
            />
            <input
              name="phone"
              placeholder="Phone"
              value={form.phone}
              onChange={handleChange}
            />
            <select name="gender" value={form.gender} onChange={handleChange}>
              <option value="">Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div className="row">
            <select
              name="department_id"
              value={form.department_id}
              onChange={handleChange}
            >
              <option value="">Department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              name="designation_id"
              value={form.designation_id}
              onChange={handleChange}
            >
              <option value="">Designation</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              name="join_date"
              type="date"
              value={form.join_date}
              onChange={handleChange}
              required
            />
            <input
              name="basic_salary"
              type="number"
              placeholder="Basic salary"
              value={form.basic_salary}
              onChange={handleChange}
              required
            />
          </div>
          <button>Register employee</button>
          {created && (
            <p className="success">
              Created. Login: {created.email} / temporary password:{" "}
              <b>{created.tempPassword}</b> (share it now, it is shown only
              once)
            </p>
          )}
        </form>
      )}
      {isHr && <CsvImport onImported={load} />}

      {error && <p className="error">{error}</p>}

      <div className="row">
        <input
          placeholder="Search name, email or code"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {isHr && (
          <button className="secondary" onClick={downloadEmployeesCsv}>
            Export CSV
          </button>
        )}
      </div>

      <Table
        columns={[
          { key: "code", label: "Code" },
          { key: "full_name", label: "Name" },
          { key: "email", label: "Email" },
          {
            key: "department",
            label: "Department",
            render: (r) => r.department || "-",
          },
          {
            key: "designation",
            label: "Designation",
            render: (r) => r.designation || "-",
          },
          { key: "status", label: "Status" },
          ...(isHr
            ? [
                {
                  key: "basic_salary",
                  label: "Basic salary",
                  render: (r) => Number(r.basic_salary).toLocaleString(),
                },
              ]
            : []),
        ]}
        rows={rows}
        empty="No employees found"
      />

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="secondary"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages} ({total} employees)
        </span>
        <button
          className="secondary"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
