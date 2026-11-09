# PaintWise

**How much paint do I actually need? And will this color even look good?** PaintWise answers both.

You enter your rooms, and it tells you how many litres (or gallons) of paint to buy, and which cans to pick up at the store. Then you can snap a photo of your wall with your phone and see it in a new color before you buy a single can. It's made for painting contractors writing up a job and for homeowners doing it themselves.

**Try it:** [paintwise-ten.vercel.app](https://paintwise-ten.vercel.app)

![PaintWise screenshot](docs/screenshot.png)

## Why I built it

This past summer, my parents decided to repaint the house and change the colors. The hardest part wasn't choosing the colors. It was figuring out how much paint we'd actually need. Between measuring every wall, skipping the doors and windows, and counting coats, we ended up guessing, and we overbought. A lot of paint went unused.

So I built PaintWise: a tool that does that math properly and still feels simple, so the next family (or the next contractor) buys the right amount the first time.

## What it does

- **Room by room:** add as many rooms as you need, and see how much paint each one takes.
- **Doors and windows are taken out** automatically, using standard sizes or your own measurements.
- **Odd-shaped rooms:** switch a room to "custom walls" and enter each wall on its own (for L-shaped rooms, a sloped ceiling or a single feature wall).
- **Real-world details:** number of coats, the coverage printed on your can, rough or textured walls (which soak up more paint), and an optional primer coat.
- **A shopping list, not just a number:** it picks the mix of can sizes that leaves you with the least paint left over. Add your store's prices and it picks the cheapest mix instead (one big bucket often costs less than three small tins).
- **Costs and quotes for contractors:** add paint prices, a labour rate and tax to get the full job cost. Fill in your client's details and print a clean, one-page quote, or save it as a PDF to send.
- **Metric or imperial:** switch between metres/litres and feet/gallons at any time, and your measurements convert automatically.
- **See the color before you paint:** point your phone's live camera at the wall (or take or upload a photo), tap the wall, and it repaints it in the color you pick. In live mode the new color follows the camera as you move. It keeps the light and shadows of the room, so it looks natural. Hold a button to compare before and after, and save the result to share it. The photo never leaves your phone.
- **Accounts and cloud projects:** create a free account and your projects are saved online, so you can start measuring on your phone and finish the quote on your laptop. Without an account, everything still works and is saved on your device.
- **Forgot your password?** Get a reset link by email. You can also change your password at any time, which logs you out everywhere else.
- **Share projects:** send any project as a link; whoever opens it gets their own copy, no account needed.
- **Remembers your job:** close the page, come back later, and everything is still there.

## How the estimate works

```
wall area = 2 × (length + width) × height − doors − windows
paint     = wall area × coats × surface factor ÷ coverage + safety margin
```

Rough walls add 15–30% paint, and the safety margin (10% by default) covers spills and touch-ups.

## How the color preview works

When you tap the wall, PaintWise spreads out from that spot and selects every connected pixel that has a similar color, stopping at sharp edges like door frames, furniture or a picture on the wall. It compares colors in a way that cares more about hue than brightness, so a wall that is lighter near the window and darker in the corner is still picked up as one wall. Then it swaps in the new color while keeping each pixel's original brightness, so shadows and lighting stay realistic. Everything runs in the browser on a `<canvas>`, without any server. In live mode the same steps run on every camera frame at a smaller size, so it stays smooth on a phone.

## How it's built

```
 Browser (HTML, CSS, JavaScript)            Vercel Functions (Node.js)           Postgres (Neon)
 ─────────────────────────────────          ──────────────────────────           ───────────────
 paint math, color preview, quote  ──API──▶ /api/auth/*   sign up, log in  ────▶ users
 works offline, no account needed          /api/projects  save and load    ────▶ sessions
                                                                                  projects
```

**Frontend**
- **Plain HTML, CSS and JavaScript**, no framework and no build step, so it loads instantly on a phone at the job site.
- **The logic is separate from the page.** The paint math ([`src/estimator.js`](src/estimator.js)), the wall recoloring ([`src/recolor.js`](src/recolor.js)) and project sharing ([`src/projects.js`](src/projects.js)) don't depend on the browser, so they are easy to test.
- **Works with or without the backend.** If the API isn't there (for example on GitHub Pages), the account features hide themselves and projects are saved on the device.

**Backend** ([`api/`](api))
- **Serverless API on Vercel Functions**: each file in `api/` is one endpoint, using Vercel's file-based routing.
- **Postgres database** with three main tables: `users`, `sessions` and `projects` (plus two small ones for rate limits and reset links). Each project is stored as `jsonb`, so the app can add fields without database migrations. Tables are created automatically on first run.
- **Accounts built from scratch, no auth library:**
  - Passwords are hashed with `scrypt` and a random salt per user. They are never stored or logged as typed.
  - Logging in creates a random session token, sent in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. The database only keeps a SHA-256 hash of it, so a database leak doesn't expose live sessions.
  - Every project query is filtered by the logged-in user, so nobody can read or edit someone else's project, even by guessing its id.
  - Write requests must be JSON, which blocks cross-site form attacks (CSRF).
  - A wrong email and a wrong password take the same time and give the same message, so attackers can't tell which emails have accounts.
  - **Rate limits** stop password guessing: after 8 failed logins on one account (or 30 from one network) in 15 minutes, logins are paused for a while. Reset emails are limited too.
  - **Password reset links** are random, single use and expire after an hour. Like session tokens, only their hash is stored. Asking for a reset gives the same answer whether the email has an account or not.
  - Changing or resetting a password **logs out every other device**.

| Method | Endpoint | What it does |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account and log in |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/me` | Who is logged in |
| `POST` | `/api/auth/password` | Change your password |
| `POST` | `/api/auth/forgot` | Email a password reset link |
| `POST` | `/api/auth/reset` | Choose a new password from the link |
| `GET` | `/api/projects` | List your projects |
| `POST` | `/api/projects` | Save a new project |
| `GET` | `/api/projects/:id` | Open a project |
| `PUT` | `/api/projects/:id` | Update a project |
| `DELETE` | `/api/projects/:id` | Delete a project |

**Tests and checks.** Every push runs three things with GitHub Actions:
- **51 unit and API tests** (`npm test`). The API tests start the real endpoints and run them against a real Postgres (PGlite, Postgres compiled to WebAssembly), covering sign-up, login, rate limits, password reset, and making sure one user can't touch another user's projects.
- **Browser tests** with [Playwright](https://playwright.dev) (`npm run test:e2e`). They open the app in a real Chrome, on a desktop and a phone screen size, and click through it like a user: measuring a room, painting a wall on a photo, signing up, saving a project, sharing a link, and resetting a forgotten password with the emailed link.
- **Type checking** with TypeScript (`npm run typecheck`). The code stays plain JavaScript with no build step, but TypeScript checks the logic and the backend for mistakes like a missing value or a wrong argument.

## Run it yourself

```sh
git clone https://github.com/Lahanas/PaintWise.git
cd PaintWise
npm install
npm run dev     # http://localhost:3000, with a local database, no setup needed
npm test        # unit and API tests
npm run test:e2e    # browser tests (first time: npx playwright install chromium)
npm run typecheck   # type checking
```

Locally, emails such as password reset links are printed in the terminal instead of being sent.

To deploy your own copy: import the repo on [Vercel](https://vercel.com), add a Postgres database from **Storage → Neon** and connect it to the project, then redeploy. The tables are created on the first request.

**Password reset emails (optional).** Without this, the app works the same, just without the "Forgot your password?" link.
1. Create a free account on [Resend](https://resend.com) and make an API key.
2. In Vercel, open **Settings → Environment Variables** and add `RESEND_API_KEY` with that key. Then redeploy.
3. Until you verify your own domain on Resend, it only delivers to the email you signed up to Resend with. Once a domain is verified, add `MAIL_FROM` (for example `PaintWise <hello@yourdomain.com>`). You can also set `APP_URL` to your site's address, so reset links always point to it.

## What's next

- [x] v0.1: rooms, doors and windows, coats, coverage, can sizes
- [x] v0.2: custom walls, surface types, primer
- [x] v0.3: color preview on a photo of your wall
- [x] v0.4: paint prices and a printable quote for clients
- [x] v0.5: live camera preview, and save and share projects
- [x] v0.6: backend with accounts and projects saved in the cloud
- [x] v0.7: password reset by email, login rate limits, type checking, and browser tests
- [ ] Next: install it on your phone like an app, and use it offline at the job site
- [ ] Later: measure a wall from a photo, and color palettes from real paint brands

## License

MIT
