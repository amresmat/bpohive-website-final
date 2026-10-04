# Qualified inbound implementation and release checklist

Updated 4 October 2026. Read the [90-day traffic plan](90-day-growth-plan.md) first. The source is a static Vercel site. `npm run build` compiles Tailwind, generates the editorial pages and funnel into `dist/`, and updates the deployed sitemap. The existing Decap blog/homepage content, detailed assessment and its edited qualified-prospect email remain intact. This document describes what is implemented locally and how to confirm the actual production workflows before publication.

## 1. Broken links and commercial navigation

Files: `vercel.json`, `scripts/growth-funnel.cjs`, `assets/css/growth.css`, `tests/growth.test.cjs`.

`/work-with-us` and `/work-with-us.html` return 301 to `/careers`; existing Work With Us labels become Careers. New `/contact` shows `info@bpohive.com`, `https://wa.me/971563755110`, `tel:+15026773800` and a short inquiry form. Commercial headers display a Book a call CTA; the mobile header gets a direct visible CTA when the desktop nav is hidden. Footer links show WhatsApp, US/Canada phone, contact and regional coverage. Careers intentionally has none of those commercial CTAs. The build resolves navigation/footer links to root-relative clean URLs.

Test: `npm run build && node --test tests/growth.test.cjs`; on the preview, `curl -I https://PREVIEW/work-with-us` must show 301 and `curl -I https://PREVIEW/contact` must show 200. Inspect mobile menu and CTA at 375px wide.

## 2. Booking, qualification and form delivery

Files: `scripts/growth-funnel.cjs`, `assets/js/growth.js`, `api/growth-lead.js`, `outbound-assessment.html` (original retained; rendered version extended in build), `api/outbound-assessment.js`, `tests/growth.test.cjs`.

The page has two paths. Path A asks name, work email, company website, market (USA, Canada, GCC, multiple), and monthly budget ($4,000–$6,999 first; $7,000–$9,999; $10,000+; below $4,000; undecided). Nothing is preselected. The first three options display an inline, prefilled Calendly. Below-threshold and undecided visitors request individual scope review, with no iframe or booking URL. Exceptions are limited, subject to scope review, and do not imply acceptance. Name, email, website, market and budget are transmitted to the existing discovery-call URL. The existing longer assessment is shown under Path B and its completed-assessment email retains the edited wording, with the approved $4,000 minimum and additional service/portal descriptions. An independently hosted Clutch 4.9/5 link, an existing verified customer quote and the minimum price are adjacent to Path A.

Server-side validation rejects unknown budgets and invalid websites; it returns no calendar URL for a below-threshold submission. A honeypot, origin check on production, size limit, memory-based rate limit and HTML escaping help prevent casual abuse. The existing Zapier webhook is used as an operational default; `GROWTH_WEBHOOK_URL` can isolate this new workflow. The new event types are `growth_strategy_submitted`, `growth_contact_submitted` and `growth_resource_submitted`, using the same `prospect_email_*` and `owner_email_*` fields as the current assessment workflow. **A 2xx webhook response is not evidence that the downstream Zap sent both emails.** Inspect or update Zapier routing for these new event types and test in a safe environment before production. If the webhook is absent/fails, the API returns a failure and the page provides contact alternatives. Qualified visitors still see the calendar if the webhook fails, so do not claim lead capture in that case.

The calendar `postMessage` listener only accepts `https://calendly.com`, the current iframe window and `calendly.event_scheduled`; a form submission or calendar display does not count as a booked call. The existing detailed path retains its event handling. `/thank-you?type=booking` reveals booking copy only after a same-browser Calendly scheduling event. Its calendar button opens Google Calendar and explicitly tells the visitor to use the exact event link in Calendly's confirmation email; it cannot invent a date-specific `.ics` link from the browser event. The inquiry version does not falsely say a call was booked.

Test: `npm run build && node --test tests/*.test.cjs && node ../qa/verify-growth.cjs`. In a test environment, submit all five budget choices and inspect the webhook event plus prospect/owner messages; book a disposable Calendly test slot only after the owner approves its operational impact, then cancel it through Calendly. Confirm under-threshold visitors never see the calendar.

## 3. Content, lead magnets and proof

Files: `scripts/growth-content.cjs`, `scripts/growth-site.cjs`, `scripts/growth-funnel.cjs`, `assets/css/growth.css`, `llms.txt`.

Five generated regional pages each exceed 1,000 words; the eight live service pages and nine industry pages are 900–1,200 words in the generated output. `/services/customer-support` remains a redirect, not a ninth commercial service page. The appointment-setting and solar-energy pages are complete editable editorial templates in `scripts/growth-content.cjs` paired with a shared page renderer. Each region has local pains, buyer roles, hours, language, legal-operating notes with official sources, clearly illustrative examples, ACES, scope/price, CTA, visible FAQs and Service/FAQPage structured data. The other service/industry pages follow the same concrete framework. Scope is priced from $4,000; Growth/Enterprise remain custom quoted. The site does not invent clients, country offices or campaign outcomes.

Pricing now states the approved minimum and links to `/appointment-setting-cost`, `/vs/in-house-sdr`, `/vs/belkins` and `/vs/salesroads`. The named comparisons link to the competitors' own current pricing pages and do not assert unlike-for-like superiority. Three regional guides at `/guides/usa`, `/guides/canada` and `/guides/gcc` contain printable worksheets. `/resources` gates the guide with name, work email and website; marketing follow-up consent is optional and separate. The four-message sequences are drafted in the 90-day plan, **not activated**: before sending, configure a mailing address, automated unsubscribe/suppression, a lawful consent basis and the email platform. Guide access does not depend on marketing opt-in.

Company-wide cumulative numbers are 21,200+ appointments and $25M+ client revenue, identified as company-reported; the unsupported appointment-setting 85% show/30% close claims are not rendered. Pricing and comparison illustrations explicitly label hypothetical arithmetic. The homepage featured/listed section links only to observed Evergreen Award, The Manifest, Clutch and GoodFirms pages, with a distinction between award and listing. Existing 11 Clutch reviews are the trust source; no invented review program.

Test: inspect generated word counts with `node --test tests/growth.test.cjs`; on preview, open `/appointment-setting-canada`, `/services/appointment-setting`, `/industries/solar-energy`, `/pricing` and each guide. Check that all visible FAQ answers match the JSON-LD and local cases are labelled illustrative.

## 4. Search and reporting

Files: `scripts/growth-funnel.cjs`, `scripts/growth-site.cjs`, `scripts/build-site.cjs`, `llms.txt`, `docs/90-day-growth-plan.md`.

The build writes the sitemap for existing indexable HTML plus generated pages, with `2026-10-04` as the modified date for this release. **When editing a page later, update the date in the generator** so future builds do not stamp an old day. `/careers`, `/form-received`, `/thank-you` and printable guides get `noindex, follow`; the first two are specifically requested. Sitewide Organization structured data includes both phone numbers and the eight country codes. Generated service/industry/country pages have Service and visible-FAQ schema. Every blog page links to two relevant service pages; every service page links to two industries, at least one country page and the booking path; every country page links to three services. Founder byline and Person schema identify the founder consistently. `llms.txt` is an optional navigation file, not a Google ranking claim.

In GA4 Explore, create a session-scoped commercial segment excluding careers/work-with-us/form-received paths. In Mouseflow, create a saved segment excluding sessions that contain those paths. Exact UI instructions, the KPI definitions and targets by region are in the traffic plan. The build emits `lead_form_start`, `lead_form_submitted`, `booking_calendar_open`, `qualified_call_booked` and `contact_channel_click` into the `dataLayer`; **GTM and GA4 still need event/tag configuration and DebugView verification**. Do not mark `booking_calendar_open` as a primary conversion. Never send PII to GA4. The reported 17% mobile careers dead-click rate is a user-supplied baseline. A sticky Apply/View positions link, labelled mobile navigation control and focus-managed application dialogs are implemented; a new rate needs actual Mouseflow measurements after publication.

Test: `npm run build && node --test tests/*.test.cjs`, `curl -I https://PREVIEW/careers`, `curl -I https://PREVIEW/form-received`, inspect their robots meta and verify `/sitemap.xml` URL count against the actual build. In GTM Preview/GA4 DebugView, confirm form starts, qualified submissions and *confirmed* bookings without names, email, company website or raw invitee URL.

## Release gates and rollback

1. Run build and all automated tests; inspect desktop and 375px mobile preview, including legible form fields, sticky Apply and regional links.
2. In Zapier, confirm routing for the three new growth events and email templates. Confirm `ZAPIER_SENDS_EMAIL` is operating as expected or set a dedicated `GROWTH_WEBHOOK_URL`; do not claim an email follow-up if it is not actually delivered.
3. Validate Calendly prefills, timezone and booking confirmation with a safe test booking, then clean up any test appointment.
4. Configure GTM/GA4 events and confirm a deduplicated booked-call conversion. Configure Mouseflow session filters and confirm no sensitive form values are recorded.
5. Review legal/campaign copy with the operator for each outreach market. The website is an operational guide, not an authorization to start outreach or spend.
6. Merge the approved PR only after Vercel preview checks, then compare production routes and logs. To roll back, use Vercel's prior successful production deployment or a revert PR; do not alter the CMS OAuth credentials.

Current repository source sitemap had **34 URLs**, contrary to the supplied 52-URL estimate. The generated sitemap has **45 indexable URLs**, excluding recruitment, confirmation and printable guide routes. This count is a build observation, not an analytics number.

The full managed service includes audience research, ICP definition, consultation and strategy, outreach, qualification, calendar booking, reporting and client-portal access. The portal description covers real-time campaign visibility and listening to qualified conversations. Reporting explains audience response, common objections and evidence for scaling. No acceptance percentage or guaranteed business transformation is claimed.
