ALTER TABLE attendance_corrections
  ADD COLUMN requested_check_in TIME,
  ADD COLUMN requested_check_out TIME;
INSERT INTO leave_types (name, yearly_quota, is_paid) VALUES
  ('annual', 14, TRUE), ('sick', 8, TRUE), ('casual', 10, TRUE), ('unpaid', NULL, FALSE);