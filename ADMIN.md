# BPO Hive content manager

Open https://www.bpohive.com/admin and sign in with the authorized GitHub account.

Blog posts: create a post, add its title, date, category, summary, image, SEO fields and article text. Save it as a draft, move it through the editorial workflow, and publish when ready. Publishing updates the blog listing, article page and sitemap after Vercel finishes building. Existing article URLs are preserved. Deletion is disabled to protect indexed URLs.

Website text: edit the five homepage heading and paragraph fields. Layout, lead routing and email templates are not editable in this collection.

Drafts do not appear on the production website. The GitHub repository is public, so draft branches and their content are publicly readable. Do not put confidential material in drafts. GitHub sessions expire after eight hours; sign out and sign in again when asked.

Authentication uses the private BPO Hive Content Manager GitHub App, installed only on amresmat/bpohive-website-final. Permissions: contents and pull requests read/write; metadata and commit statuses read-only. No private key or installation token is used. The server exchanges an authorization code with PKCE and signed state, verifies the GitHub account and repository write permission, then delivers a short-lived user token only to the canonical site origin.

Vercel production variables: CMS_GITHUB_CLIENT_ID, CMS_GITHUB_CLIENT_SECRET, CMS_STATE_SECRET. Optional CMS_ALLOWED_USERS defaults to amresmat. Secrets must never be committed. Callback: https://www.bpohive.com/api/cms/callback. Authentication on preview domains is deliberately unavailable.

Build: npm ci then npm run build. Test: npm run test:cms. The dist directory contains only deployable static files; root api functions remain Vercel serverless functions. Baselines retain the exact original HTML for unchanged imported articles; edited/new articles use the shared article template.
