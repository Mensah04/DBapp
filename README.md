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
3. Create a `.env` file in the project root to configure optional credentials and settings. Example entries:

```
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
PASTOR_EMAIL=pastor@church.com
PORT=3000
```

4. Ensure MongoDB is running locally (default URI: `mongodb://localhost:27017/followups`) or set `MONGODB_URI` in `.env`.
5. Start the server in development mode:

```bash
npm install
node server.js
```

6. Open the app at `http://localhost:3000`.

7. Default admin: create a `SystemUser` document in the `systemusers` collection or use the existing script `seed-admin.js` (if present) to create an initial admin account.

Testing

- Basic API health check:

```bash
curl http://localhost:3000/api/test
```

- Fetch members:

```bash
curl http://localhost:3000/api/users
```

- Run automated tests (if you add tests):

```bash
npm test
```

Notes

- The app uses ES modules (`type: module`); run with a recent Node.js LTS (>=16).
- If you need to change the MongoDB URI or port, add `MONGODB_URI` and `PORT` to `.env` and update `server.js` accordingly.