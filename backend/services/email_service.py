import logging

import resend

from backend.core.config import settings

logger = logging.getLogger(__name__)


def is_email_configured() -> bool:
    return bool(settings.RESEND_API_KEY)


# Alias for backward compatibility
is_smtp_configured = is_email_configured


async def _send(to: str, subject: str, html: str) -> None:
    resend.api_key = settings.RESEND_API_KEY
    # Use verified domain sender, or Resend's test sender for unverified domains
    from_addr = settings.RESEND_FROM or "Noteflow <onboarding@resend.dev>"
    try:
        resend.Emails.send({
            "from": from_addr,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        raise


async def send_invite_email(
    to_email: str,
    inviter_name: str,
    notebook_name: str,
    join_url: str,
) -> None:
    subject = f'{inviter_name} invited you to "{notebook_name}" on Noteflow'
    html = f"""\
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <h2 style="font-size:18px;margin:0 0 16px">You're invited to collaborate</h2>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px">
    <strong>{inviter_name}</strong> invited you to the notebook
    <strong>&ldquo;{notebook_name}&rdquo;</strong> on Noteflow.
  </p>
  <a href="{join_url}"
     style="display:inline-block;background:#4A90D9;color:#fff;text-decoration:none;
            padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">
    Join Notebook
  </a>
  <p style="color:#888;font-size:12px;margin:24px 0 0">
    If you don't have a Noteflow account, you'll be asked to register first.
  </p>
</div>"""
    await _send(to_email, subject, html)


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    subject = "Reset your Noteflow password"
    html = f"""\
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <h2 style="font-size:18px;margin:0 0 16px">Reset your password</h2>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px">
    You requested a password reset for your Noteflow account.
    Click the button below to set a new password. This link is valid for <strong>30 minutes</strong>.
  </p>
  <a href="{reset_url}"
     style="display:inline-block;background:#5b8c15;color:#fff;text-decoration:none;
            padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">
    Reset Password
  </a>
  <p style="color:#888;font-size:12px;margin:24px 0 0">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>"""
    await _send(to_email, subject, html)
