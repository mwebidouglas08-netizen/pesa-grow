# 🌿 Pesa Grow — Smart Investment Platform

Kenya's #1 investment platform. Built with Node.js + Express + SQLite.

## ⚡ Quick Start

### Option A — Open Directly (No server needed)
Just open `pesagrow.html` in any browser. Everything works offline.

### Option B — Full Node.js Backend (Production)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Start server
node server.js
# Server runs on http://localhost:3000
```

## 🔐 Admin Access

- **URL:** Open the site → Login → "Admin Login" button
- **Username:** `admin`
- **Password:** `PesaGrow@2026`
- Change credentials in Settings after first login!

## 📞 Support Contact
- Phone/WhatsApp: **0796 820 013**

## 🏗️ Features

### User Features
- ✅ Register / Login / Forgot Password
- ✅ 4 Investment Plans (Starter, Growth, Gold, Platinum)
- ✅ Deposit via M-Pesa, BTC, USDT, Bank Transfer
- ✅ Withdraw to M-Pesa or crypto wallet
- ✅ Real-time profit tracking (ticks every second)
- ✅ Full transaction history
- ✅ Referral system (5% commission)
- ✅ Support ticket system
- ✅ Profile management / password change

### Admin Features
- ✅ Dashboard with live stats
- ✅ Full user management (add, edit, suspend, adjust balance)
- ✅ Approve/reject deposit requests
- ✅ Process/reject withdrawal requests
- ✅ Manage investment plans (add, edit, disable)
- ✅ View all investments, cancel if needed
- ✅ Support ticket management with replies
- ✅ Platform settings (currency, limits, referral %)
- ✅ Admin credential management
- ✅ Full data export (JSON)

## 📁 File Structure

```
pesagrow/
├── pesagrow.html      ← Standalone complete app (open in browser)
├── server.js          ← Node.js backend server
├── .env.example       ← Environment config template
├── package.json       ← Dependencies
├── README.md          ← This file
└── public/            ← Place frontend files here for Node.js serving
    └── index.html
```

## 🔌 API Endpoints

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Login
- `POST /api/auth/admin` — Admin login

### User
- `GET /api/user/me` — Get profile
- `PUT /api/user/profile` — Update profile
- `PUT /api/user/password` — Change password

### Plans
- `GET /api/plans` — List active plans

### Investments
- `POST /api/investments` — Create investment
- `GET /api/investments` — My investments

### Deposits / Withdrawals
- `POST /api/deposits` — Submit deposit
- `POST /api/withdrawals` — Request withdrawal
- `GET /api/transactions` — Transaction history

### Support
- `POST /api/tickets` — Submit ticket
- `GET /api/tickets` — My tickets

### Admin (requires admin JWT)
- `GET /api/admin/dashboard`
- `GET/PUT /api/admin/users`
- `POST /api/admin/users/:id/adjust-balance`
- `GET /api/admin/investments`
- `GET /api/admin/transactions`
- `PUT /api/admin/transactions/:id/approve`
- `PUT /api/admin/transactions/:id/reject`
- `GET/POST/PUT /api/admin/plans`
- `GET/PUT /api/admin/tickets/:id/reply`
- `PUT /api/admin/tickets/:id/resolve`
- `GET/PUT /api/admin/settings`

## 🚀 Deployment (VPS/Ubuntu)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 process manager
npm install -g pm2

# Start app
pm2 start server.js --name pesagrow
pm2 startup
pm2 save

# Setup Nginx reverse proxy
# sudo apt install nginx
# Configure nginx to proxy port 3000 → port 80/443
```

## 📞 Contact
- WhatsApp: 0796 820 013
- Email: support@pesagrow.co.ke
