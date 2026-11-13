# JMS Textiles Billing System

A React + Vite billing and stock app with an Express + Node.js API that stores data in a local JSON file. The app supports barcode/QR scanner keyboard input, inventory, checkout, sales history and a daily summary.

## Features

- Scan a product barcode/QR code with a phone camera or USB/Bluetooth scanner (the scanner types into the focused barcode field and sends Enter), or search by name/SKU. Camera access requires permission and HTTPS (or localhost).
- Add items to a bill, adjust quantities, set an optional discount and GST percentage, and save the sale.
- GST is included in the item rate by default (the customer pays rate x qty - discount; the GST inside it is shown in the tax table and the receipt says "Inclusive of All Taxes"). Untick **GST included in rate** to add GST on top instead.
- Bill totals are rounded off to the nearest rupee by default, shown as **Round Off** on the receipt. Untick it per bill to keep paise.
- GST reports for accounts: a daily JSON summary and a monthly Excel workbook (daily rows + monthly summary), protected by `REPORT_TOKEN`.
- Invoice numbers use the format `JMS-YYYYMMDD-N`; the final number starts at 1 and increments across days.
- Stock is checked and decremented on the server when a bill is saved. The invoice has a printable layout.
- Add and edit products, including SKU, barcode, price and opening stock.
- View recent bills and sales totals.

## Run locally

Requirements: Node.js 20+ and a Postgres database (a free [Neon](https://neon.tech) project works).

1. Copy `server/.env.example` to `server/.env` and fill in every value. The server will not allow login until `ADMIN_USERNAME`, `ADMIN_PASSWORD` and a 32+ character `JWT_SECRET` are set; there are no default credentials.
2. From this folder run:

   ```bash
   npm install
   npm run install:all
   npm run dev
   ```

3. Open <http://localhost:5180>. The API runs on <http://localhost:5000/api>.

## Deploy on Vercel (new project)

1. Push this repo to GitHub (keep it **private**).
2. In Vercel choose **Add New -> Project**, import the repo and keep **Root Directory** as the repository root (`vercel.json` deploys `client` and `server` together).
3. Create a Neon database (Vercel Marketplace -> Neon, or neon.tech) and add the variables from `server/.env.example` under Project Settings -> Environment Variables. Use the **pooled** connection string.
4. Deploy. Your URL is `https://<project-name>.vercel.app`; add a custom domain under Settings -> Domains if you want.

## Security notes

- No default login. Passwords are compared in constant time, and login is limited to 10 attempts per 15 minutes per IP; all API routes are rate-limited and sent with security headers (Helmet).
- Database connections verify TLS (use `sslmode=require`).
- Bills are never deleted. Use **Cancel bill** instead: it keeps the record, removes it from sales totals and returns stock to inventory. Bulk "clear all" endpoints were removed.
- Stock +/- uses `stockDelta`, applied on the server inside a transaction, so it cannot overwrite a sale.
- Invoice numbers use the IST date (`JMS-YYYYMMDD-N`).
- Session token lasts 12 hours. Never commit `.env`. Back up the database (Neon offers point-in-time restore).

## API overview

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/products?search=` · `POST /api/products` · `PATCH /api/products/:id` (supports `stockDelta`) · `DELETE /api/products/:id`
- `GET /api/bills` (filters: mode, period, paymentMethod, search, page, limit) · `POST /api/bills` · `POST /api/bills/:id/void`
- `GET /api/dashboard/summary`
- `GET /api/reports/daily?token=...&date=YYYY-MM-DD` (default: yesterday, IST) · `GET /api/reports/gst.xlsx?token=...&month=YYYY-MM` — need `REPORT_TOKEN` (24+ characters); disabled when it is not set

## Notes

- Confirm your GST rates, invoice format and legal requirements with your accountant before relying on invoices for statutory accounting.
