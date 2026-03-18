# PESA GROW — Deployment Guide

## Quick Start (5 Minutes)

### 1. Install Node.js
Download from: https://nodejs.org (v18 or higher)

### 2. Install dependencies
```
npm install
```

### 3. Configure environment
```
cp .env.example .env
```
Then edit `.env` with your actual values.

### 4. Start the server
```
node server.js
```

The app runs at: http://localhost:3000

---

## M-Pesa Daraja Setup (IMPORTANT)

### Step 1: Get Daraja API Credentials
1. Go to https://developer.safaricom.co.ke
2. Create account / login
3. Click "Create App"
4. Select APIs: "Lipa Na M-Pesa Online" (STK Push)
5. Copy your **Consumer Key** and **Consumer Secret**

### Step 2: Get your Passkey
- In sandbox: Use the passkey in .env.example (it's the standard sandbox passkey)
- In production: Go to your app → "Lipa Na M-Pesa" → copy passkey

### Step 3: Set your Shortcode
- Sandbox testing: Use shortcode 174379
- Production: Use your actual Till Number (e.g. 0796820013) or Paybill number

### Step 4: Configure Callback URL
Your server MUST be publicly accessible for M-Pesa to send callbacks.

**Option A — Use Render.com (Free Hosting):**
1. Push code to GitHub
2. Go to render.com → New Web Service
3. Connect your GitHub repo
4. Set environment variables in Render dashboard
5. Your URL: https://pesagrow.onrender.com
6. Set BASE_URL=https://pesagrow.onrender.com in .env

**Option B — Use ngrok (Local testing):**
```
npx ngrok http 3000
```
Copy the https URL → set as BASE_URL in .env

**Option C — VPS (DigitalOcean/Vultr/AWS):**
- Get a KES 600/month VPS
- Install Node.js, run `node server.js`
- Use your server IP or domain as BASE_URL

### Step 5: Go Live
Change in .env:
```
MPESA_ENV=live
MPESA_SHORTCODE=your_actual_till_number
MPESA_PASSKEY=your_live_passkey
BASE_URL=https://yourdomain.com
```

---

## Admin Login
- URL: http://localhost:3000/admin.html
- Email: admin@pesagrow.co.ke
- Password: Admin@2024

---

## File Structure
```
pesagrow/
├── server.js          ← Backend (Node.js + Express + M-Pesa)
├── package.json       ← Dependencies
├── .env.example       ← Environment variables template
├── .env               ← Your actual config (never share this!)
├── pesagrow.db        ← SQLite database (auto-created)
├── README.md          ← This file
└── public/            ← Frontend files (put here)
    ├── index.html
    ├── dashboard.html
    └── admin.html
```

## Render.com Deployment (Recommended Free Option)

1. Create account at render.com
2. New → Web Service
3. Connect GitHub with your code
4. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. Add all .env variables in Environment tab
6. Deploy!

Your site will be at: https://your-app-name.onrender.com
