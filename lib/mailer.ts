import axios from "axios";

/**
 * Transactional email through Brevo's HTTP API (free plan: 300 emails a day). Needs BREVO_API_KEY and MAIL_FROM,
 * a sender address confirmed in Brevo. Without them nothing is sent and the site says so instead of pretending:
 * password reset then goes through the admin.
 */
export function mailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BREVO_API_KEY?.trim() && env.MAIL_FROM?.trim());
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Mail {
  to: string;
  subject: string;
  /** Plain paragraphs; a link is shown as a button */
  paragraphs: string[];
  link?: { url: string; label: string };
}

export function renderMail(mail: Mail): { html: string; text: string } {
  const text = [...mail.paragraphs, ...(mail.link ? [`${mail.link.label}: ${mail.link.url}`] : []), "", "CryptoPredict"].join("\n\n");
  const button = mail.link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(mail.link.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${escapeHtml(mail.link.label)}</a></p>
<p style="color:#6b7280;font-size:12px">Если кнопка не работает, откройте ссылку: ${escapeHtml(mail.link.url)}</p>`
    : "";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
<p style="font-weight:600;font-size:18px">CryptoPredict</p>
${mail.paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join("\n")}
${button}
</div>`;
  return { html, text };
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!mailConfigured()) throw new Error("Почта не настроена (BREVO_API_KEY, MAIL_FROM)");
  const { html, text } = renderMail(mail);
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { email: process.env.MAIL_FROM!.trim(), name: process.env.MAIL_FROM_NAME?.trim() || "CryptoPredict" },
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: html,
      textContent: text,
    },
    { headers: { "api-key": process.env.BREVO_API_KEY!.trim(), accept: "application/json" }, timeout: 15_000 }
  );
}
