import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from backend.core.config import settings


def is_smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER)


def _build_invite_email(
    to_email: str,
    inviter_name: str,
    notebook_name: str,
    join_url: str,
) -> MIMEMultipart:
    sender = settings.SMTP_FROM or settings.SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{inviter_name} invited you to \"{notebook_name}\" on Noteflow"
    msg["From"] = sender
    msg["To"] = to_email

    text = (
        f"{inviter_name} invited you to collaborate on \"{notebook_name}\" in Noteflow.\n\n"
        f"Click to join: {join_url}\n\n"
        "If you don't have an account yet, you'll need to register first."
    )

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

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


def _send_sync(msg: MIMEMultipart, to_email: str) -> None:
    if settings.SMTP_PORT == 465:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.sendmail(msg["From"], [to_email], msg.as_string())
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            s.starttls()
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.sendmail(msg["From"], [to_email], msg.as_string())


def _build_password_reset_email(to_email: str, reset_url: str) -> MIMEMultipart:
    sender = settings.SMTP_FROM or settings.SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset your Noteflow password"
    msg["From"] = sender
    msg["To"] = to_email

    text = (
        "You requested a password reset for your Noteflow account.\n\n"
        f"Click the link below to reset your password (valid for 30 minutes):\n{reset_url}\n\n"
        "If you didn't request this, you can ignore this email."
    )

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

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    msg = _build_password_reset_email(to_email, reset_url)
    await asyncio.to_thread(_send_sync, msg, to_email)


async def send_invite_email(
    to_email: str,
    inviter_name: str,
    notebook_name: str,
    join_url: str,
) -> None:
    msg = _build_invite_email(to_email, inviter_name, notebook_name, join_url)
    await asyncio.to_thread(_send_sync, msg, to_email)
