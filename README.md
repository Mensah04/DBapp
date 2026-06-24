# RCCG TOP – Church Management System

A complete church management system with member database, attendance tracking, follow-up management, dashboard analytics, and PWA installation.

## Features
- Member database (CRUD with role‑based access)
- Attendance check‑in/out with QR self check‑in
- Follow‑up tracking
- Analytics dashboard
- Dark mode & PWA installable
- Role‑based access (admin / secretary / viewer)

## Tech Stack
- Backend: Node.js, Express, MongoDB, Mongoose
- Frontend: HTML5, Tailwind CSS, JavaScript, Chart.js
- PWA: Service Worker, Web App Manifest

## Installation
1. Clone the repo
2. Run `npm install`
3. Create `.env` file with your Infobip SMS credentials (optional)
4. Start MongoDB locally
5. Run `node server.js`
6. Visit `http://localhost:3000`

Default admin login: `admin` / `admin123`