// Sending email (password reset links) through Resend's HTTP API.
// Set RESEND_API_KEY in Vercel to turn it on; without it, the reset feature is hidden.
import { HttpError } from './http.js';

let customMailer = null;

/** Tests and local dev can capture emails instead of sending them. */
export function setMailer(fn) {
  customMailer = fn;
}

export function mailEnabled() {
  return !!customMailer || !!process.env.RESEND_API_KEY;
}

export async function sendMail({ to, subject, text, html }) {
  if (customMailer) return customMailer({ to, subject, text, html });
  if (!process.env.RESEND_API_KEY) throw new HttpError(503, "Password reset by email isn't set up on this site yet.");
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'PaintWise <onboarding@resend.dev>', to: [to], subject, text, html }),
  });
  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    throw new HttpError(502, "We couldn't send the email. Please try again later.");
  }
}
