import pool from '../db.js';
import { getStatuses } from './attendance.js';
import { countWorkingDays } from './leave.js';

const round = (n) => Math.round(n * 100) / 100;

// Tax slab is applied on annual gross (monthly gross x 12)
export const calculateMonthlyTax = (monthlyGross) => {
  const annual = monthlyGross * 12;
  let tax;

  if (annual <= 600000) tax = 0;
  else if (annual <= 1200000) tax = 0.05 * (annual - 600000);
  else if (annual <= 2400000) tax = 30000 + 0.15 * (annual - 1200000);
  else if (annual <= 3600000) tax = 210000 + 0.25 * (annual - 2400000);
  else tax = 510000 + 0.35 * (annual - 3600000);

  return round(tax / 12);
};

const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

// Builds payslip numbers for every employee employed during the month
export const buildPayroll = async (month) => {
  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const workingDays = await countWorkingDays(monthStart, monthEnd);
  if (workingDays === 0) {
    throw new Error('This month has no working days');
  }

  const employees = (
    await pool.query(
      `SELECT id, basic_salary, join_date::text AS join_date, exit_date::text AS exit_date
       FROM employees
       WHERE join_date <= $2 AND (exit_date IS NULL OR exit_date >= $1)
       ORDER BY id`,
      [monthStart, monthEnd]
    )
  ).rows;

  if (employees.length === 0) return [];

  const statuses = await getStatuses(employees.map((e) => e.id), monthStart, monthEnd);

  const unpaidLeaves = (
    await pool.query(
      `SELECT r.employee_id, r.start_date::text AS s, r.end_date::text AS e
       FROM leave_requests r
       JOIN leave_types t ON t.id = r.leave_type_id
       WHERE r.status = 'approved' AND t.is_paid = FALSE
         AND r.start_date <= $2 AND r.end_date >= $1`,
      [monthStart, monthEnd]
    )
  ).rows;

  const slips = [];

  for (const emp of employees) {
    const from = maxDate(monthStart, emp.join_date);
    const to = emp.exit_date ? minDate(monthEnd, emp.exit_date) : monthEnd;

    const eligibleDays = from <= to ? await countWorkingDays(from, to) : 0;

    const own = statuses.filter((s) => s.employee_id === emp.id);
    const absentDays = own.filter((s) => s.status === 'absent').length;
    const halfDays = own.filter((s) => s.status === 'half_day').length;
    const lateDays = own.filter((s) => s.status === 'late').length;
    const latePenaltyDays = Math.floor(lateDays / 3) * 0.5;

    let unpaidDays = 0;
    for (const leave of unpaidLeaves.filter((l) => l.employee_id === emp.id)) {
      const s = maxDate(leave.s, from);
      const e = minDate(leave.e, to);
      if (s <= e) unpaidDays += await countWorkingDays(s, e);
    }

    const basic = Number(emp.basic_salary);
    const hra = basic * 0.4;
    const medical = basic * 0.1;
    const gross = basic * 1.5;
    const perDay = gross / workingDays;

    const prorationDeduction = perDay * (workingDays - eligibleDays);
    const absentDeduction = perDay * absentDays;
    const unpaidDeduction = perDay * unpaidDays;
    const halfDayDeduction = perDay * 0.5 * halfDays;
    const latePenaltyDeduction = perDay * latePenaltyDays;


    const deductions = Math.min(
      gross,
      prorationDeduction + absentDeduction + unpaidDeduction + halfDayDeduction + latePenaltyDeduction
    );
    const tax = calculateMonthlyTax(gross);
    const net = Math.max(0, gross - deductions - tax);

    slips.push({
      employee_id: emp.id,
      gross: round(gross),
      deductions: round(deductions),
      tax,
      net: round(net),
      details: {
        basic: round(basic),
        hra: round(hra),
        medical: round(medical),
        workingDays,
        eligibleDays,
        perDay: round(perDay),
        absentDays,
        unpaidDays,
        halfDays,
        lateDays,
        latePenaltyDays,
        latePenaltyDeduction: round(latePenaltyDeduction),
        prorationDeduction: round(prorationDeduction),
        absentDeduction: round(absentDeduction),
        unpaidDeduction: round(unpaidDeduction),
        halfDayDeduction: round(halfDayDeduction),
      },
    });
  }

  return slips;
};