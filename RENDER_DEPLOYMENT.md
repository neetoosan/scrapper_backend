# Deploying Edge Contact Scraper Backend to Render

This guide outlines how to deploy the server-side Python **FastAPI + Scrapy** backend for Edge Contact Scraper to [Render](https://render.com/).

---

## 📋 Pre-deployment Summary

The repository is pre-configured with full support for Render deployment out of the box:

- **`render.yaml`**: Pre-configured Render Blueprint spec for 1-click infrastructure setup.
- **`backend/Dockerfile`**: Containerized Python 3.12 environment with Scrapy & FastAPI dependencies, dynamic `$PORT` binding, and health checks.
- **`backend/config.py`**: Auto-detects Render's dynamic `PORT` environment variable.

---

## 🚀 Option 1: Deploy via Render Blueprint (Recommended)

Render Blueprints let you deploy infrastructure automatically using the included `render.yaml` file.

### Step 1: Push Code to GitHub
Ensure your latest code, including `render.yaml` and the `backend/` folder, is pushed to your GitHub repository.

### Step 2: Create Blueprint Instance on Render
1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** at the top right and select **Blueprint**.
3. Connect your GitHub account and select your repository (`edgewebscraper`).
4. Render will detect `render.yaml` and display the `edgewebscraper-backend` web service.
5. Click **Apply**. Render will automatically build and deploy your Docker container!

---

## 🛠️ Option 2: Manual Web Service Setup via Render Dashboard

If you prefer setting up the Web Service manually without Blueprints:

1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository** and connect your repo.
4. Configure the service settings:
   - **Name**: `edgewebscraper-backend`
   - **Language / Environment**: `Docker`
   - **Root Directory**: `backend`
   - **Dockerfile Path**: `Dockerfile`
   - **Instance Type**: `Free`
5. Expand **Advanced** and set:
   - **Health Check Path**: `/health`
6. Add Environment Variables under **Environment**:
   - `CORS_ORIGINS`: `*` (or your extension's origin)
   - `SCRAPER_MAX_CONCURRENT_JOBS`: `5`
   - `SCRAPER_DEFAULT_MAX_PAGES`: `12`
   - `SCRAPER_DOWNLOAD_DELAY`: `0.5`
7. Click **Create Web Service**.

> ℹ️ *Note: Render automatically injects the `PORT` environment variable (usually port 10000). The application dynamically binds to this port automatically.*

---

## 🔍 Verification & Health Check

Once deployment is complete, Render will assign a public URL (e.g., `https://edgewebscraper-backend.onrender.com`).

### 1. Health Check Endpoint
```bash
curl https://<your-render-service>.onrender.com/health
```
**Expected Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "active_jobs": 0
}
```

### 2. Interactive Swagger API Docs
Open your browser and navigate to:
```
https://<your-render-service>.onrender.com/docs
```
Here you can test all live REST endpoints:
- `POST /api/scrape` — Start a new scraping job
- `GET /api/scrape/{job_id}` — Check status & fetch extracted contact items
- `GET /api/scrape/{job_id}/export` — Download generated XLSX workbook
- `GET /api/jobs` — List active and completed jobs

---

## 💡 Important Render Free Tier Tip

Render's free web services automatically spin down (sleep) after 15 minutes of inactivity. 
When a new request comes in (or when your browser extension sends a scrape request), Render will wake up the service automatically (which takes ~20–30 seconds for cold start). 
Sending an initial request to `/health` when opening the extension ensures the service is warm and ready!
