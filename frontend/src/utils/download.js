import api from '../api';

// Fetches a PDF with the auth token and saves it in the browser
export const downloadPayslip = async (payslipId, filename = 'payslip.pdf') => {
  const response = await api.get(`/payroll/payslips/${payslipId}/pdf`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const downloadEmployeesCsv = async () => {
  const response = await api.get('/employees/export', { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'employees.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};