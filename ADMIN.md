# BPO Hive admin

Open https://www.bpohive.com/admin and sign in with the authorized GitHub account.

Everything you publish goes live about a minute later, after Vercel rebuilds the site. There are no drafts: Publish means live. Every change is saved in GitHub history and can be undone there.

What you can edit:

- Job openings: title, description, location, type, department and the JotForm link. Turn off "Open" to hide a job without deleting it.
- Blog posts: title, date, category, summary, image and article text. Deleting posts is disabled to protect indexed URLs.
- Team members: name, title, bio, photo, LinkedIn (About page).
- Case studies (Case studies page).
- Website settings: homepage text and stats, office locations (cards and map pins), and the Sign in link, contact email and Calendly link used across the site.

"Order" fields: lower numbers show first.

If a change does not appear after a few minutes, the build probably rejected it (for example a link that does not start with https://). Check the latest deployment in Vercel; the live site keeps the previous version until the problem is fixed.

Technical notes: the admin is Decap CMS (admin/config.yml, JSON syntax). Content lives in content/. scripts/build-site.cjs and scripts/cms-sections.cjs render it into dist at build time, between the BPO-HIVE-* markers in careers.html, about.html and case-studies.html and the cms: markers in index.html. Authentication uses the private BPO Hive Content Manager GitHub App, installed only on amresmat/bpohive-website-final, with PKCE and signed state. Vercel production variables: CMS_GITHUB_CLIENT_ID, CMS_GITHUB_CLIENT_SECRET, CMS_STATE_SECRET; optional CMS_ALLOWED_USERS defaults to amresmat. Secrets must never be committed. Callback: https://www.bpohive.com/api/cms/callback. Sign in does not work on preview domains. The repository is public, so all content files are publicly readable. Build: npm ci then npm run build. Test: npm run test:cms.
