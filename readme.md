# Backend - Google Maps Scraper

This is the **backend service** for the Google Maps Scraper project.  
It handles the scraping process, WebSocket communication, CSV generation, and temporary file management using **Node.js**, **Express**, and **Puppeteer**.

---

## Features

- Scrape Google Maps business data (name, phone, address, website)
- Communicate via WebSockets for real-time logs
- Export scraped data as `.csv`
- Auto-delete temporary files after download
- Works locally and in production (Render / VPS)

---

## Tech Stack

| Layer | Technology |
|--------|-------------|
| **Server** | Node.js, Express.js |
| **Scraper** | Puppeteer, Sparticuz Chromium (for Render) |
| **Communication** | WebSocket (ws) |
| **Hosting** | Render / VPS |
| **File Handling** | Node fs, os modules |

---

## Environment Variables

Create a `.env` file in your backend root folder:

```bash
# Local Development
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
PORT=4000

# Production (Render)
NODE_ENV=production
FRONTEND_URL=https://frontend.vercel.app
PORT=10000
RENDER=true
```

---

## Local Development

```bash
# Install dependencies
npm install

# Run in dev mode
npm run dev
```

Server runs by default on:
```
http://localhost:4000
```

---

## Deployment (Render)

1. Push your backend code to GitHub.
2. Create a **Web Service** on Render.
3. Set environment variables (from `.env`).
4. Use these commands:
   - **Build command:** `npm install`
   - **Start command:** `npm start`

The backend will serve WebSockets and APIs for the frontend to connect.

---

## Output Files

Scraped CSVs are generated in a temporary directory (like `/tmp/maps-scraper`), and automatically deleted after download.

---

## License

MIT License © 2025 [FluxMessenger]
