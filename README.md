# HCM Lite

AI-assisted Human Capital Management system for Admin, HR and Employees (Saylani Hackathon, 24 Oct 2026).

- Live app: https://hcm-lite-j1rp.vercel.app/
- API: https://hcm-lite-six-xi.vercel.app//api
- Repository: https://github.com/shayan-malik/hcm-lite

## Stack
- Backend: Node.js, Express, PostgreSQL (Neon, plain `pg`), JWT, bcrypt, PDFKit (ES Modules)
- Frontend: React (Vite), React Router, Axios, Recharts
- AI: any OpenAI-compatible API with tool calling (Groq by default), key kept on the server only
- Hosting: Vercel (frontend and backend), Neon (database)

## Run locally
1. Create a PostgreSQL database (Neon is fine) and run `backend/schema.sql` in its SQL editor.
   Then run the extra statements listed in "Database notes" below.
2. Backend:
   ```
   cd backend
   cp .env.example .env     # fill in DATABASE_URL, JWT_SECRET, AI_API_KEY
   npm install
   npm run dev
   ```
3. Frontend:
   ```
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```
4. Open http://localhost:5173

## First run (create the first Admin)
The system starts empty. Opening the app shows the Setup page: enter the company name and the Admin
email and password. Then:
1. Admin sets office hours, office location and radius, departments, designations, holidays, and creates an HR login.
2. HR signs in (changes the temporary password), registers employees. Each employee gets a login with a temporary password.
3. Employees check in/out, apply for leave (also in plain words with AI), HR approves.
4. HR creates the monthly payroll draft, Admin finalizes it, employees download payslips.

## AI key
Set `AI_API_KEY` (and optionally `AI_BASE_URL`, `AI_MODEL`) in `backend/.env` locally or in the Vercel
project environment variables. The browser never calls the AI provider.
Features: chat with tools, dashboard summary, smart leave (never saves, user confirms), policy Q&A.
Limits: 15 s timeout, 20 requests per user per hour, every call logged in `ai_logs`, answers labeled "AI-generated".

## Roles and security
- JWT login, bcrypt hashed passwords.
- Every API checks role and data scope on the server (an Employee only reads their own rows).
- The AI tools reuse the same services and the same role checks.
- Finalized payroll is locked. Audit log (actor, action, entity, before/after) is read-only and Admin-only.

## Done
Modules M1 to M9: auth and roles, organization setup, employees (search, filters, paging), attendance
(check-in/out, status rules, corrections), leave (working days, overlap and balance checks, approval),
payroll (rules, tax slab, finalize, PDF payslip), dashboards with filters, AI assistant, announcements,
notifications, audit log.

## Not done
- CSV import/export with dry run
- Camera + location attendance, mobile app
- Automated tests
- Attrition risk score, dark mode, other bonus items

## Database notes
Besides `schema.sql`, these were applied:
```sql
ALTER TABLE attendance_corrections
  ADD COLUMN requested_check_in TIME,
  ADD COLUMN requested_check_out TIME;
INSERT INTO leave_types (name, yearly_quota, is_paid) VALUES
  ('annual', 14, TRUE), ('sick', 8, TRUE), ('casual', 10, TRUE), ('unpaid', NULL, FALSE);
```
(Better: paste both into `schema.sql` too, so one file is enough.)