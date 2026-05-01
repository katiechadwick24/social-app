# Deploy Socials

This app is ready to run as a small hosted Node web app.

## Recommended: Render

1. Create a new **Web Service** on Render.
2. Connect the GitHub repo that contains this folder.
3. Use these settings:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/healthz`
4. Add environment variables:
   - `ANTHROPIC_API_KEY`: your Anthropic API key
   - `APP_PASSWORD`: a private password for the site
   - `STATE_FILE`: `/var/data/save.json` if you add a Render persistent disk
5. Optional but recommended: add a persistent disk mounted at `/var/data`.

Without a persistent disk, the hosted app can still run, but saves may disappear when the service restarts.

## Local

Create a `.env` file next to `server.js`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
APP_PASSWORD=optional-local-password
STATE_FILE=save.json
```

Then run:

```bash
npm start
```

Open `http://localhost:3000`.
