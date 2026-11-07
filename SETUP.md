SETUP CHECKLIST — things only you can do
========================================

Do Part A right now (approvals can take time). Do Part B once the code is
pushed. Paste keys into the .env.local file yourself — don't paste them in chat.


PART A — API KEYS (do now, ~20 min)
-----------------------------------

[ ] 1. Create your local env file
       - In the project folder, copy .env.example and rename the copy to .env.local
       - Fill in each value below as you get it. .env.local is git-ignored.

[ ] 2. Gemini API key (main AI: extraction, tags, summaries, search, embeddings)
       - Go to https://aistudio.google.com/apikey and sign in with a Google account
       - Click "Create API key" (let it create a new project if asked)
       - Copy the key -> GEMINI_API_KEY=

[ ] 3. Groq API key (fast fallback AI)
       - Go to https://console.groq.com and sign in
       - Left sidebar -> "API Keys" -> "Create API Key", name it "pullup"
       - Copy it immediately (shown only once) -> GROQ_API_KEY=

[ ] 4. Ticketmaster API key (concerts, sports, ticketed events)
       - Go to https://developer-acct.ticketmaster.com/user/register and create an account
       - After confirming your email, open "My Apps" -> the default app
       - Copy the "Consumer Key" -> TICKETMASTER_API_KEY=

[ ] 5. SeatGeek client ID (more ticketed events)
       - Go to https://seatgeek.com/account/develop (log in or sign up)
       - Click "Create New App", fill in name "PullUp" and any website
       - Copy the "Client ID" -> SEATGEEK_CLIENT_ID=
       - If approval is pending or it fails, tell me — SeatGeek is optional.

[ ] 6. Reddit app (Reddit posts + upvotes)
       - Log in to Reddit, then go to https://www.reddit.com/prefs/apps
       - Scroll down -> "create another app..."
            name:         pullup
            type:         choose "script"
            redirect uri: http://localhost:8080
       - Click "create app"
       - The client ID is the short string under "personal use script"
            -> REDDIT_CLIENT_ID=
       - The "secret" -> REDDIT_CLIENT_SECRET=
       - Your username -> REDDIT_USERNAME=  (used only in the User-Agent string)
       - If Reddit says you need to request API access / approval, tell me —
         we have a fallback that reads public Reddit pages.

[ ] 7. Admin secret (protects the live pipeline page)
       - Make up a long random string, e.g. smash the keyboard for 24 chars
       - -> ADMIN_SECRET=
       - The admin page will be at  https://<your-domain>/admin/<ADMIN_SECRET>


PART B — HOSTING + DOMAIN (after I push the scaffold, ~20 min)
--------------------------------------------------------------

[ ] 8. Buy the domain
       - Cloudflare Registrar (https://dash.cloudflare.com -> Domain Registration)
         is easiest because DNS is in the same place. Namecheap also works.

[ ] 9. Railway account
       - Go to https://railway.com and sign up WITH GITHUB
       - Upgrade to the Hobby plan (~$5/month) so volumes and custom domains work

[ ] 10. Give Railway access to the repo
       - The repo is github.com/spicypark/CrimsonHacks2026.
         The "spicypark" account (or an org admin) must approve Railway's
         GitHub app for this repo. If that's not your account, ask its owner.

[ ] 11. Create the Railway project
       - Railway dashboard -> "New Project" -> "Deploy from GitHub repo"
         -> pick CrimsonHacks2026 -> branch main
       - It will try to build immediately; a failed first build is fine.

[ ] 12. Add a volume (persistent SQLite storage)
       - Open the service -> right-click the canvas / "+ New" -> "Volume"
       - Attach it to the service, mount path:  /data

[ ] 13. Set environment variables on Railway
       - Service -> "Variables" -> "Raw Editor"
       - Paste the same lines from your .env.local, plus:
            DATABASE_PATH=/data/pullup.db
            NODE_ENV=production
       - Railway redeploys automatically.

[ ] 14. Connect your domain
       - Service -> "Settings" -> "Networking" -> "Custom Domain" -> type your domain
       - Railway shows a CNAME target (something.up.railway.app) and maybe a TXT record
       - In Cloudflare DNS (or Namecheap "Advanced DNS") add exactly those records
            Cloudflare: set the CNAME to "DNS only" (grey cloud) until Railway
            shows the domain as verified, then you may turn the proxy on.
       - Wait for the green check in Railway (usually 1–10 min).

[ ] 15. Tell me the domain so I can set it as the app's public URL.


PART C — CLAUDE CODE SKILLS
---------------------------

[ ] 16. The skills /thermo-nuclear-code-quality-review and
        /improve-codebase-architecture were installed after this session started
        and can only be started by you. If typing them here doesn't work, open a
        new Claude Code session in this folder and run them there.
        Planned times: ~9:30 PM (architecture) and ~11:30 PM (quality review).
