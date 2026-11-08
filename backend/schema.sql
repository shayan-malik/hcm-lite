-- Extra column for attendance corrections
ALTER TABLE attendance_corrections
  ADD COLUMN IF NOT EXISTS requested_check_in TIME,
  ADD COLUMN IF NOT EXISTS requested_check_out TIME;

-- Default leave types (quotas from the brief)
INSERT INTO leave_types (name, yearly_quota, is_paid) VALUES
  ('annual', 14, TRUE),
  ('sick', 8, TRUE),
  ('casual', 10, TRUE),
  ('unpaid', NULL, FALSE)
ON CONFLICT (name) DO NOTHING;