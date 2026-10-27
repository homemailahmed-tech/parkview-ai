# Free, phone-only demo deployment (Vercel Hobby)

**Status: prepared, not deployed.** Each step below is done by the owner on an Android phone in Chrome. Nothing needs a laptop.

## Why Vercel Hobby

| Need | Vercel Hobby |
| --- | --- |
| Free | $0 per month. Usage caps pause features rather than billing, and a free account can't buy extra usage |
| Credit card | Not requested at sign-up for Hobby, according to several independent guides. Vercel's own pages don't state it explicitly. **If a card is ever requested, stop and report back.** |
| Private GitHub repo | Supported from a **personal** GitHub account (ours is). Private repos owned by GitHub *organisations* need Pro |
| Next.js | Built by the makers of Next.js. No configuration needed: API routes, middleware and the build all work |
| Phone-only setup | Sign up with GitHub, import, set variables and deploy all happen in the mobile browser |
| Terms | Hobby is for **personal, non-commercial** use. A hackathon prototype with fictional data fits. Real guest-house business use later would need the Pro plan |

Alternatives considered:
- **Netlify Free:** no card needed, but its free-plan support for private repos could not be confirmed.
- **Render Free:** community reports say it asks for a card for verification.
- **Cloudflare Workers:** needs an adapter and command-line setup, which is not phone-friendly.

## Security built into the app

Vercel's password protection is a paid feature, so the app provides its own protection:

| Protection | How |
| --- | --- |
| **Demo access code** (`DEMO_ACCESS_CODE`) | Every page and API asks for the code first. It is stored as a signed, HttpOnly, SameSite=Strict cookie for 7 days. Share it with judges |
| **Owner code** (`OWNER_ACCESS_CODE`) | Approving quotes, recording payments and the AI provider tools need an owner login. This is a signed HttpOnly cookie that lasts 12 hours. Keep the code private. Without it, owner controls stay locked |
| Brute-force limits | 10 code attempts per 15 minutes per address. AI and other APIs allow 40 requests per minute |
| Server-only secrets | API keys are read only on the server. Tests check that browser code never reads environment variables |
| Security headers | Strict Content-Security-Policy, no framing, no camera/microphone/location access, HSTS, `noindex` and a `robots.txt` that blocks crawlers |
| Spend guards | Simulation mode is the default. `AI_DAILY_CALL_LIMIT` caps live calls. Google Maps stays disabled. OpenRouter is free-only |
| Data | All guests, numbers, bookings, rates and the guest house are fictional. Each visitor's changes stay in their own browser only, with no shared database |

## What the owner does on Android

### Step 1: Put the finished code on `main` (2 minutes)

Vercel publishes the repository's `main` branch. The work currently sits on branch `ccr-1508cf57-kr9ve8`.
1. Approve opening the pull request. Claude will open it on request.
2. In Chrome, open the pull request link, scroll down and tap **Merge pull request** → **Confirm merge**.
   The repository stays **private**.

### Step 2: Choose two codes (1 minute)

Write down two different phrases, each **at least 8 characters**, for example:
- Demo code for judges: something like `parkside-judges-7419`
- Owner code, private: something like `owner-only-5823-zx`

Also create a random **session secret** of 32 or more characters, for example from a password generator.

### Step 3: Create the free Vercel account (2 minutes)

1. In Chrome, open **vercel.com/signup**.
2. Choose **Hobby** and enter a name.
3. Tap **Continue with GitHub** and approve. You are already signed in to GitHub on the phone.

### Step 4: Import the private repository (3 minutes)

1. On the Vercel dashboard tap **Add New…** → **Project**.
2. Under *Import Git Repository*, if `meta-hospitality-ai` is not listed, tap **Adjust GitHub App Permissions** / **Install**.
   Choose **Only select repositories** → `meta-hospitality-ai` → **Install**.
3. Tap **Import** next to `meta-hospitality-ai`.
4. Framework Preset should show **Next.js**. Leave the build settings unchanged.

### Step 5: Add the settings before deploying (3 minutes)

Expand **Environment Variables** and add each name and value:

| Name | Value |
| --- | --- |
| `DEMO_ACCESS_CODE` | your judges' code |
| `OWNER_ACCESS_CODE` | your private owner code |
| `SESSION_SECRET` | your random 32+ character string |
| `AI_MODE` | `simulation` |
| `AI_DAILY_CALL_LIMIT` | `50` |

Do **not** add any AI or Google keys yet.

### Step 6: Deploy (2–3 minutes; this is the approval moment)

Tap **Deploy** and wait for the confetti screen. Tap **Continue to Dashboard** → **Visit**. The address looks like `https://meta-hospitality-ai-xxxx.vercel.app`.

### Step 7: Check it on the phone (5 minutes)

1. The **Demo access code** page appears. Enter the judges' code and you should see the dashboard with a **Simulation** badge.
2. Go to Enquiries → Lindiwe and run the steps: Read with AI → Find room options → Use Option A → Submit for owner approval.
3. Tap **🔒 Owner** and enter the owner code. Then: Approve → Mark as sent → Guest accepted → Request deposit → Record simulated deposit → Confirm.
4. Open **Smart Maps**, tap a suggested question, then tap **Directions**. Google Maps should open.
5. In Chrome tap **⋮ → Add to Home screen** for an app-like icon.

### Sharing with judges

Send the `.vercel.app` link and the **demo code** only. Never share the owner code. To let judges try approvals themselves in
their own private copy, add `DEMO_PUBLIC_OWNER_MODE` = `true` and redeploy.

### Changing a code or setting later

Vercel → project → **Settings → Environment Variables** → edit → then **Deployments → ⋮ → Redeploy**.
Changing a code signs everyone out.

## Tips for using a phone

- If a Vercel button seems missing, tap Chrome **⋮ → Desktop site**, then switch back afterwards.
- Pushes to `main` redeploy automatically. Other branches create **preview** links. Vercel protects those with Vercel login by default.
- Turning on real Meta AI later only means adding the keys from `docs/ACTIVATE_META_AI.md` in Step 5's screen, then redeploying.
