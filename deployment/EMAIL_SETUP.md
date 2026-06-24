# Production email setup (Resend)

Vorliq sends real email for four things: the weekly member digest, per-event
member notifications (VLQ received, loan funded/repaid, governance outcome), and
operator monitoring alerts. All of them go through one transactional-email
provider configured by four environment variables. **Until those variables are
set, every email is written to a log file instead of being sent** — nothing
breaks, but no mail is delivered.

The production deploy pipeline (`.github/workflows/deploy.yml`, step "Configure
transactional email provider") writes these variables into
`/etc/vorliq/backend.env` on the server from GitHub Actions secrets, so the key
and from-address never appear in the repository. If the key secret is unset the
step is a clean no-op and email stays in log-only mode.

## What was already set up

- `deploy.yml` reads the secrets below and writes them into the server env file
  on every deploy (and restarts the backend and chain so they take effect).
- `POST /api/admin/test-email` (admin token) sends a test email through the
  configured provider and reports the channel used (`emailed` = reached the
  provider, `logged` = no provider configured).
- The send mechanism itself was verified on production: with a capture endpoint
  standing in for the provider, the backend POSTed exactly the payload Resend
  expects — `{"from","to","subject","text"}` with an `Authorization: Bearer <key>`
  header. Pointing the URL at Resend (the key secret below) makes it real inbox
  delivery.

## The one remaining step: add the Resend credentials (≈5 minutes)

1. **Create a free Resend account** at <https://resend.com>. The free tier is
   ample (3,000 emails/month).
2. **Get a sending identity.** Two options:
   - *Fastest, for testing:* use Resend's sandbox sender `onboarding@resend.dev`.
     It needs no domain verification, but it can only deliver to the email address
     you signed up with. Good for confirming delivery works.
   - *For real members:* in Resend, **Add a domain** (e.g. `mail.vorliq.org`) and
     add the DNS records Resend shows you at your domain registrar. Once it shows
     "Verified", you can send from any address on that domain (e.g.
     `Vorliq <notifications@mail.vorliq.org>`) to anyone.
3. **Create an API key** in Resend (Dashboard → API Keys → Create). Copy it; it
   starts with `re_`.
4. **Add three GitHub repository secrets** (Settings → Secrets and variables →
   Actions → New repository secret):
   | Secret name | Value |
   | --- | --- |
   | `VORLIQ_EMAIL_API_KEY` | the `re_...` key from step 3 (required) |
   | `VORLIQ_EMAIL_FROM` | `Vorliq <onboarding@resend.dev>` for the sandbox, or `Vorliq <notifications@yourdomain>` once your domain is verified |
   | `VORLIQ_ALERT_EMAIL` | the inbox that should receive operator alerts, e.g. `you@yourdomain` |

   `VORLIQ_EMAIL_API_URL` defaults to `https://api.resend.com/emails`; only set the
   optional secret of that name if you use a different provider.
5. **Re-run the deploy** (push any commit, or re-run the latest "Vorliq Deploy"
   workflow). The "Configure transactional email provider" step writes the
   variables and restarts the services.
6. **Confirm it sends.** Either:
   - `curl -X POST https://vorliq.org/api/admin/test-email -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' --data '{"to":"you@yourdomain"}'`
     and check the response says `"channel":"emailed"` and the mail arrives (or
     appears in the Resend dashboard's Emails log); or
   - sign in, go to **Settings → Email notifications**, save your email, enable
     "VLQ received", have another wallet send you VLQ, and watch for the email
     when the block confirms.

If a send ever fails, the reason is logged to `backend/data/emails.log` on the
server (and the alerts log for operator alerts), and delivery falls back to the
log so an email is never lost.

## If the server is rebuilt

Nothing to redo by hand: the four variables are written by the deploy pipeline
from the GitHub secrets on the next deploy. Just make sure the three secrets above
still exist in the repository, then deploy.
