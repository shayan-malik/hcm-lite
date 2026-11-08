# HCM Lite: Frontend

React (Vite) web app for HCM Lite. It talks to the backend only through the REST API and never calls the AI provider directly.

## Stack
React, React Router, Axios, Recharts, MediaPipe (face detection), vite-plugin-pwa

## Run
```
cp .env.example .env     # set VITE_API_URL
npm install
npm run dev              # http://localhost:5173
```

Build and preview (needed to test the PWA):
```
npm run build
npm run preview
```

## Environment
| Name | Example |
|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` (local) or `https://<backend>.vercel.app/api` (hosted) |

Vite reads this at build time, so on Vercel set it before deploying and redeploy after changing it.

## Structure
```
src/
  api.js                 Axios instance, adds the JWT token to every request
  authContextValue.js    Auth context and useAuth hook
  AuthContext.jsx        Auth provider (login, logout, password change)
  menu.js                Role-based menu (Admin, HR, Employee)
  App.jsx                Routes and role-based page selection
  components/            Layout, Table, KpiCard, CsvImport, CameraCheckIn
  pages/                 Setup, Login, Dashboard, Employees, Attendance, Leave,
                         Payroll, Payslips, Profile, Organization, Users,
                         Announcements, Notifications, AuditLog, Assistant
  utils/download.js      PDF and CSV downloads with the auth token
```

## Notes
- Hiding a menu item is only for the UI. Every permission is checked again on the server.
- Camera and location need HTTPS (or localhost). Phones give better GPS accuracy than laptops.
- Dark mode choice is saved in the browser. The app is installable as a PWA.
- `vercel.json` rewrites all routes to `index.html` so page refresh works with React Router.