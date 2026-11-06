# Analytics

**Active collection: no.**
**Code-ready adapter: yes.**

The checker and the audit-kit page load `analytics-config.js` and `analytics.js`. With the config shipped in this repo, `tobbyTrack` returns without calling `fetch`, `sendBeacon`, or writing storage. Do not describe telemetry as live until a real Umami website id is present and a browser request actually reaches the collect endpoint.

## What was already in the repo

There was no analytics snippet, website id, tag manager, or analytics host in the pages, `app.js`, or git history. The PageSpeed Insights key in `app.js` is the existing checker key. The adapter never reads it and drops any payload that contains an `AIza` key.

## Provider choice

Checked against the vendors' own docs on 6 Nov 2026:

| Option | Hosted and $0? | Usable without an account? | Decision |
| --- | --- | --- | --- |
| Umami Cloud Hobby | Yes. $0/month, 1 website, 100,000 events/month, 6 months of retention ([pricing](https://umami.is/pricing), [Cloud FAQ](https://docs.umami.is/docs/cloud/faq)). The Cloud overview lists custom events on all plans. Umami's pricing FAQ says events past the included amount are billed; the published per-event rates are on the paid plans. Staying inside the Hobby allowance is what keeps this at $0. | No. Signup, email verification, and a US or EU data region are required before a website UUID exists. | Selected, but left unwired. |
| Umami self-hosted | The software is free. | It needs a server we run. | Not used. |
| Plausible Cloud | No free hosted plan. A 30-day trial requires an account, then paid plans (Starter is paid). | No. | Not used. A trial and a paid plan are out of scope. |
| Plausible self-hosted | Community Edition is free software. | It needs a server we run. | Not used. |

No account was created. No website id was invented.

## Config that is still missing

`analytics-config.js` must stay inactive until all of these are true:

1. `provider` is `umami` (already set). This alone does nothing.
2. `endpoint` is exactly `https://gateway.umami.is/api/send`. That is the Umami Cloud collect URL from [Sending stats](https://docs.umami.is/docs/api/sending-stats). Confirm the doc still names that URL before pasting it. Any other endpoint is ignored.
3. `websiteId` is the UUID from your own Umami Cloud website (`data-website-id` in the tracker snippet Umami shows after you add the site). The documentation example `94db1cb1-74f4-4a40-ad6c-962362670409` is rejected on purpose.
4. `enabled` is `true`.

Until 2–4 are filled with real values, collection stays off.

Umami's hosted tracker was not embedded. That script keeps a session cache and, unless `data-exclude-search` is set, sends the full URL including the query string. The checked page is stored in `?url=`, so the stock script would collect submitted URLs.

## What a future enabled event contains

Each accepted call is one POST with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and no `x-umami-cache` header. The JSON body is only:

- `type`: `event`
- `payload.website`: the configured UUID
- `payload.hostname`: this site's hostname
- `payload.url`: pathname only, such as `/` or `/core-web-vitals-audit-kit/`
- `payload.name`: omitted for a pageview; otherwise one of the names below

Event names:

- `pageview`
- `checker_start`
- `checker_success`
- `checker_error_invalid_url`
- `checker_error_rate_limit`
- `checker_error_key_rejected`
- `checker_error_unreachable`
- `checker_error_test_failed`
- `checker_error_timeout`
- `checker_error_network`
- `kit_cta_checker_results`
- `kit_cta_kit_hero`
- `kit_cta_kit_pricing`

There is no event-property object. Umami counts each stored property as another event, and a property would be another place for a URL to leak.

The response can include `cache`, `sessionId`, and `visitId`. The adapter cancels the body and does not store or resend them. Because of that, Umami's visitor and session totals will not represent people. Use the event counts. Those counts are not fabricated by this site; this repo shows none.

Do Not Track (`1` or `yes`) and Global Privacy Control skip sending.

The adapter does not set cookies and does not read or write `localStorage` or `sessionStorage`. The checker still stores an optional PageSpeed key under `psiKey` when someone submits the key form. That behavior predates this adapter.

## $0 limit

Stay on Umami Cloud Hobby. Do not start a Plausible trial, a Umami paid trial, or a self-hosted server for this. Keep event volume inside the 100,000 events included on Hobby. This adapter sends no event properties, so one action counts as one event.
