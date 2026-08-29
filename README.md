# Delivery Partner Web App

Mobile-first frontend for delivery partners (milk delivery app). Multi-page
static site — no build step required. Shares the design system and API
conventions of the customer/admin apps.

## Structure

```
/
├── index.html              ← entry point, redirects into /pages based on session
├── pages/                  ← all app screens (login, home, active-orders, etc.)
├── css/                    ← shared + per-page stylesheets
├── js/                     ← shared + per-page scripts
├── images/                 ← logo / avatar placeholder assets
├── _headers                ← Cloudflare Pages cache headers
└── _redirects              ← Cloudflare Pages redirect rules
```

## Running locally

No build step — it's static HTML/CSS/JS. Serve the folder with any static
server, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

### Demo mode (no backend needed)

Open `pages/login.html` and tap **"Skip login (demo mode)"**. This seeds
mock orders/profile/history into `localStorage` and routes all API calls
through `js/delivery-mock.js` instead of the real backend — useful for
UI review before the backend is wired up.

**Before going live**, delete:
- `js/delivery-mock.js`
- the `<script src="../js/delivery-mock.js">` tag from every page in `/pages`
- the "Skip login (demo mode)" button block in `pages/login.html` and its
  handler in `js/login.js`

All of these are marked `TEMPORARY` in comments.

## Connecting to the real backend

1. Open `js/delivery-api.js` and set `API_BASE` to your backend's API root:
   ```js
   const API_BASE = "https://your-backend.onrender.com/api";
   ```
   Leave it as `"/api"` only if this frontend is served from the **same
   origin** as the backend (e.g. Express serving these static files
   directly).

2. Open `js/delivery-socket.js` and confirm the Socket.io client script tag
   in each protected page points at the right origin:
   ```html
   <script src="https://your-backend.onrender.com/socket.io/socket.io.js"></script>
   ```
   (Currently set to the same-origin path `/socket.io/socket.io.js` in every
   page under `/pages`.)

3. JWT is stored in `localStorage` under `db_token` and sent as
   `Authorization: Bearer <token>` on every request — no further wiring
   needed once `API_BASE` is correct.

## Deploying

### Option A — Cloudflare Pages (static hosting)

1. Push this folder to a GitHub repo.
2. In Cloudflare Pages: **Create a project → Connect to Git**.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: `/` (repo root)
4. Deploy. `index.html` at the root is served automatically.
5. If your backend lives elsewhere, set `API_BASE` (step above) to its full
   URL before deploying — Cloudflare Pages only serves static files, it
   won't proxy `/api` for you unless you add a Cloudflare Worker/Function.

### Option B — Render Static Site

1. Push this folder to a GitHub repo.
2. In Render: **New → Static Site**, connect the repo.
3. Build command: *(leave blank)*
4. Publish directory: `.` (repo root)
5. Deploy. Render serves `index.html` at the root automatically.

### Option C — Same server as the backend (Express `express.static`)

If your Node/Express backend also serves this frontend:

```js
app.use(express.static(path.join(__dirname, "delivery")));
```

With this setup, keep `API_BASE = "/api"` and the Socket.io script path as
`/socket.io/socket.io.js` — everything resolves same-origin with no CORS
config needed.

## Notes

- All protected pages load `delivery-auth.js` first (JWT + status guard),
  then `delivery-layout.js` (topbar + bottom nav), then the page's own
  script — this order matters, don't reorder the `<script>` tags.
- Accept/Start/Deliver actions never update the UI optimistically; they
  always wait for the server's 200/409 response (see `home.js`,
  `order-detail.js`).
- Bottom-nav and internal links use `js/delivery-transitions.js` for an
  app-like fade transition between pages instead of a hard reload.
