# HCM Lite

AI-assisted Human Capital Management system for Admin, HR and Employees (Saylani Hackathon, 24 Oct 2026).

- Live app: https://hcm-lite-j1rp.vercel.app/
- API: https://hcm-lite-six-xi.vercel.app/api
- Repository: https://github.com/shayan-malik/hcm-lite

## Stack
- Backend: Node.js, Express, PostgreSQL (Neon, plain `pg`), JWT, bcrypt, PDFKit (ES Modules)
- Frontend: React (Vite), React Router, Axios, Recharts, MediaPipe, PWA
- AI: any OpenAI-compatible API with tool calling (Groq by default), key kept on the server only
- Hosting: Vercel (frontend and backend), Neon (database)

## Run locally
1. Create a PostgreSQL database (Neon is fine) and run the whole `backend/schema.sql` in its SQL editor.
   That one file creates all tables and the default leave types.
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
   cp .env.example .env     # VITE_API_URL=http://localhost:5000/api
   npm install
   npm run dev
   ```
4. Open http://localhost:5173

## Environment variables (backend)
| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon pooled link on Vercel) |
| `JWT_SECRET` | Secret used to sign login tokens |
| `OFFICE_TZ` | Office time zone, default `Asia/Karachi` |
| `AI_API_KEY` | Key of the LLM provider (server only) |
| `AI_BASE_URL` | OpenAI-compatible API URL, default Groq |
| `AI_MODEL` | Model with tool calling support |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COMPANY_NAME` | Optional, see "First run" |

Never commit the real `.env`. Only `.env.example` is in the repository.

## First run (create the first Admin)
The system starts empty, there is no dummy data. Open the app and the Setup page asks for the
company name and the Admin email and password. Then:
1. Admin sets office hours, office location and radius, departments, designations, holidays, and creates an HR login.
2. HR signs in (changes the temporary password) and registers employees. Each employee gets a login with a temporary password.
3. Employees check in/out, apply for leave (also in plain words with AI), HR approves.
4. HR creates the monthly payroll draft, Admin finalizes it, employees download payslips.

Alternatively set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `COMPANY_NAME`) in the backend
environment. On start, if the system is empty, the first Admin is created automatically.
These are left empty on the hosted demo so judges see the Setup page.

## AI key
Set `AI_API_KEY` (and optionally `AI_BASE_URL`, `AI_MODEL`) in `backend/.env` locally or in the Vercel
project environment variables. The browser never calls the AI provider.
Features: chat with tools, dashboard summary, smart leave (never saves, the user confirms), policy Q&A.
Limits: 15 s timeout, 20 requests per user per hour, every call logged in `ai_logs`, answers labeled "AI-generated".

## Roles and security
- JWT login, bcrypt hashed passwords.
- Every API checks role and data scope on the server (an Employee only reads their own rows).
- The AI tools reuse the same services and the same role checks.
- Finalized payroll is locked. The audit log (actor, action, entity, before/after) is read-only and Admin-only.

## Done
All 25 functionalities across modules M1 to M9:
- Auth and roles (JWT, bcrypt, server-side role and data-scope checks), first-run setup, env Admin seeding
- Organization setup, employees (search, filters, paging, Employee 360, own profile edit)
- CSV import with dry-run error report (row, field, reason) and CSV export
- Attendance: server-stamped check-in/out, late/half-day/absent/missing_checkout rules, corrections
- Leave: working days only, overlap and balance checks (422), approval inbox, cancel
- Payroll: salary rules, tax slab, proration, finalize and lock, payslip PDF
- Dashboards (Admin, HR, Employee) with date and department filters, charts
- AI assistant: chat with tools, dashboard summary, smart leave, policy Q&A, key only on the server,
  15 s timeout, 20 requests per user per hour, `ai_logs`, "AI-generated" label
- Announcements, notifications, audit log

Bonus:
- Camera attendance in the browser (laptop or phone): face detection (MediaPipe), GPS accuracy limit (100 m),
  server-side Haversine office geofence
- Late penalty rule (3 lates = 0.5 day), attendance anomaly flags, attrition risk score (rule-based, with reasons)
- AI understands Roman Urdu, dark mode, installable PWA, responsive mobile menu
- Unit tests for payroll tax slabs and the late penalty rule (`cd backend && npm test`)

## Not done
- Native mobile app (the web app is responsive and installable as a PWA instead)
- Face matching against an enrolled face and blink liveness (only face detection is done)
- More automated tests (leave and attendance services are not covered yet)

## Database
`backend/schema.sql` is the only file needed. It creates all tables, adds the correction time columns
and inserts the default leave types (annual 14, sick 8, casual 10, unpaid unlimited).