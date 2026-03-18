# 🚀 Pesa Grow — Deployment Guide

## Admin Login
- **Email:** admin@pesagrow.co.ke
- **Password:** Admin@2024

---

## Option 1: Railway.app (RECOMMENDED — Free + Always On)

Railway is the best choice: no sleep mode, built-in HTTPS, and free $5/month credit.

### Steps:

**1. Push code to GitHub**
```bash
cd pesagrow
git init
git add .
git commit -m "Pesa Grow v2"
# Create a new repo at github.com then:
git remote add origin https://github.com/YOUR_USERNAME/pesagrow.git
git push -u origin main
```

**2. Deploy on Railway**
1. Go to [railway.app](https://railway.app) → Login with GitHub
2. Click **New Project → Deploy from GitHub Repo**
3. Select your `pesagrow` repo
4. Railway auto-detects Node.js and deploys

**3. Set Environment Variables**
In Railway → your service → **Variables** tab, add:

```
PORT=3000
JWT_SECRET=your_long_random_secret_here
BASE_URL=https://your-app.up.railway.app
ADMIN_PHONE=0796820013

# M-Pesa (get from developer.safaricom.co.ke)
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
```

**4. Get your URL**
Railway assigns a URL like: `https://pesagrow-production.up.railway.app`
Update `BASE_URL` in Variables to this URL.

**5. Done!** Your site is live.

---

## Option 2: Render.com (Free — but sleeps after 15 min)

> ⚠️ Not recommended for M-Pesa callbacks — the server sleeps and misses callbacks.

1. Push to GitHub (same as above)
2. Go to [render.com](https://render.com) → New Web Service
3. Connect GitHub repo
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Add environment variables in Settings

---

## Option 3: VPS (Best for Production)

If you have a VPS (DigitalOcean, Vultr, Hetzner):

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your repo
git clone https://github.com/YOUR_USERNAME/pesagrow.git
cd pesagrow

# Install dependencies
npm install

# Copy and edit .env
cp .env.example .env
nano .env  # Fill in your values

# Install PM2 (process manager)
npm install -g pm2
pm2 start server.js --name pesagrow
pm2 startup  # Auto-restart on reboot
pm2 save

# Install Nginx (reverse proxy)
sudo apt install nginx
# Configure nginx to proxy port 80 → 3000
# Then install SSL with: sudo apt install certbot
# certbot --nginx -d yourdomain.com
```

---

## M-Pesa Daraja Setup

1. Go to [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an account → Create App
3. Copy **Consumer Key** and **Consumer Secret**
4. For sandbox testing:
   - Shortcode: `174379`
   - Passkey: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`
   - Test phone: `254708374149` (PIN: `12345`)
5. For live (production):
   - Apply for Go-Live on the Daraja portal
   - Get your actual Till Number and Passkey
   - Set `MPESA_ENV=live`

### Callback URL
Your `BASE_URL` must be:
- HTTPS (not HTTP)
- Publicly accessible (not localhost)
- Set before testing STK Push

---

## File Structure
```
pesagrow/
├── server.js          ← Main backend server
├── package.json       ← Dependencies
├── .env.example       ← Environment template
├── pesagrow.db        ← SQLite database (auto-created)
├── uploads/           ← KYC document uploads
└── public/
    ├── index.html     ← Landing page
    ├── dashboard.html ← User dashboard
    └── admin.html     ← Admin panel
```

---

## Default Investment Plans
| Plan     | ROI/Day | Period | Min KES    | Max KES     |
|----------|---------|--------|------------|-------------|
| Starter  | 3%      | 7 days | 1,000      | 9,999       |
| Silver   | 5%      | 14 days| 10,000     | 49,999      |
| Gold     | 7%      | 21 days| 50,000     | 199,999     |
| Platinum | 10%     | 30 days| 200,000    | No limit    |

---

## Support
📞 **0796820013**  
💬 WhatsApp: +254796820013
