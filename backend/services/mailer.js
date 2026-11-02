import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

/**
 * Outbound email for platform notifications (approval requests and decisions).
 * Uses the SMTP settings from the environment; in development it falls back to
 * an Ethereal test inbox, or the log when that isn't reachable.
 *
 * `queueMail` never throws and doesn't make the caller wait: a slow or broken
 * mail server must not hold up (or undo) the action that triggered the email.
 */

let testSender = null;

/** Tests replace the transport with a function receiving { to, subject, html }. */
export const setMailSender = (fn) => {
  testSender = fn;
};

const getTransporter = async () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  if (process.env.NODE_ENV === 'development') {
    try {
      const account = await nodemailer.createTestAccount();
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
        tls: { rejectUnauthorized: false },
      });
    } catch {
      logger.warn('Ethereal Email unavailable, emails will be logged to console');
      return null;
    }
  }
  throw new Error('SMTP not configured');
};

export const sendMail = async (to, subject, html) => {
  if (testSender) return testSender({ to, subject, html });
  const transporter = await getTransporter();
  if (!transporter) {
    logger.info(`Email (dev console): To: ${to}, Subject: ${subject}`);
    return null;
  }
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_FROM_EMAIL || 'noreply@salesdam.com',
    to,
    subject,
    html,
  });
  logger.info(`Email sent: ${info.messageId}`);
  return info;
};

/** Fire-and-forget send. Resolves when the attempt finished (tests await this). */
export const queueMail = (to, subject, html) =>
  Promise.resolve()
    .then(() => sendMail(to, subject, html))
    .catch((err) => logger.error(`Failed to send email to ${to}: ${err.message}`));

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The branded layout the Lead approval emails have always used. */
export const approvalEmailHtml = ({ heading, color = '#244c64', greeting, paragraphs = [], reason = '', buttons = [] }) => `<!DOCTYPE html>
<html>
  <head>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: ${color}; color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
      .content { padding: 20px 0; }
      .reason { background: #fef2f2; border-left: 4px solid #ef4444; padding: 10px 14px; border-radius: 4px; margin: 12px 0; }
      .button { display: inline-block; background: ${color}; color: #fff !important; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 15px 8px 0 0; }
      .footer { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h2>${escapeHtml(heading)}</h2></div>
      <div class="content">
        <p>${escapeHtml(greeting)}</p>
        ${paragraphs.map((p) => `<p>${p}</p>`).join('\n        ')}
        ${reason ? `<div class="reason"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ''}
        ${buttons.map((b) => `<a href="${escapeHtml(b.url)}" class="button">${escapeHtml(b.label)}</a>`).join('')}
      </div>
      <div class="footer"><p>This is an automated message from Salesdam. Please do not reply to this email.</p></div>
    </div>
  </body>
</html>`;

export { escapeHtml };
