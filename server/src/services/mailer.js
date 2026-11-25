import nodemailer from 'nodemailer';
import { HttpError } from '../utils.js';

/** Optional SMTP mailer for meeting invitations. Without SMTP_* settings the UI falls back to a mailto: link. */
export function createMailer(smtp) {
  if (!smtp?.host) {
    return {
      configured: false,
      async sendInvite() {
        throw new HttpError(503, 'Email sending is not configured on the server (set SMTP_* in server/.env).');
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    configured: true,
    async sendInvite({ to, subject, text, html }) {
      await transport.sendMail({ from: smtp.from || smtp.user, to, subject, text, html });
    },
  };
}
