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
    from_addr = settings.RESEND_FROM or "Noteflow <noreply@noteflow.jotoai.com>"
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


async def send_health_alert_email(to_email: str, failed_services: list[dict]) -> None:
    subject = f"[Noteflow Alert] {len(failed_services)} service(s) down"
    rows = ""
    for svc in failed_services:
        rows += f"""<tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600">{svc['name']}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#dc2626">{svc['message']}</td>
        </tr>"""
    html = f"""\
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px">
  <h2 style="font-size:18px;margin:0 0 16px;color:#dc2626">Service Health Alert</h2>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px">
    The following service(s) are currently unreachable:
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 24px">
    <tr style="background:#f9fafb">
      <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Service</th>
      <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Error</th>
    </tr>
    {rows}
  </table>
  <p style="color:#888;font-size:12px;margin:0">
    Checked at {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}
  </p>
</div>"""
    await _send(to_email, subject, html)


async def send_resource_alert_email(
    to_email: str,
    breaches: list[dict],
    host: dict,
    containers: list[dict],
) -> None:
    """Send an email alert when host/container resource thresholds are exceeded."""
    subject = f"[Noteflow Alert] Resource usage high — {len(breaches)} threshold(s) breached"

    # Breach details
    breach_rows = ""
    for b in breaches:
        breach_rows += f"""<tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#dc2626">{b['description']}</td>
        </tr>"""

    # Host overview
    host_section = f"""
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 16px">
      <tr style="background:#f9fafb">
        <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left" colspan="2">Host Resources</th>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">CPU</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;{_color(host['cpu_percent'], 90)}">{host['cpu_percent']}%</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">Memory</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;{_color(host['memory_percent'], 90)}">{host['memory_used_gb']}GB / {host['memory_total_gb']}GB ({host['memory_percent']}%)</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">Disk</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;{_color(host['disk_percent'], 90)}">{host['disk_used_gb']}GB / {host['disk_total_gb']}GB ({host['disk_percent']}%)</td>
      </tr>
    </table>"""

    # Container table
    container_rows = ""
    for c in containers:
        container_rows += f"""<tr>
          <td style="padding:6px 12px;border:1px solid #e5e7eb">{c['name']}</td>
          <td style="padding:6px 12px;border:1px solid #e5e7eb;{_color(c['cpu_percent'], 80)}">{c['cpu_percent']}%</td>
          <td style="padding:6px 12px;border:1px solid #e5e7eb;{_color(c['memory_percent'], 85)}">{c['memory_mb']}MB ({c['memory_percent']}%)</td>
        </tr>"""

    container_section = f"""
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 24px">
      <tr style="background:#f9fafb">
        <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Container</th>
        <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">CPU</th>
        <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Memory</th>
      </tr>
      {container_rows}
    </table>""" if containers else ""

    html = f"""\
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:580px;margin:0 auto;padding:32px">
  <h2 style="font-size:18px;margin:0 0 16px;color:#ea580c">Resource Usage Alert</h2>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px">
    The following resource threshold(s) have been exceeded for 2+ consecutive checks:
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 16px">
    <tr style="background:#fef2f2">
      <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">Breached Threshold</th>
    </tr>
    {breach_rows}
  </table>
  {host_section}
  {container_section}
  <p style="color:#888;font-size:12px;margin:0">
    Checked at {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}
  </p>
</div>"""
    await _send(to_email, subject, html)


def _color(value: float, threshold: int) -> str:
    """Return inline CSS color style if value exceeds threshold."""
    return "color:#dc2626;font-weight:600" if value >= threshold else ""


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
