import { createEmailVerifyToken, type UserRecord } from "@/lib/auth";
import { mailConfigured, sendMail } from "@/lib/mailer";

/** Sends the email-confirmation link; false when mail is not set up or sending failed (logged). */
export async function sendVerificationEmail(user: Pick<UserRecord, "id" | "email">, origin: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    const token = await createEmailVerifyToken(user.id);
    await sendMail({
      to: user.email,
      subject: "Подтвердите email на CryptoPredict",
      paragraphs: [
        "Вы зарегистрировались на CryptoPredict. Подтвердите, что это ваш адрес — по нему можно будет восстановить пароль.",
        "Ссылка действует 48 часов. Если вы не регистрировались, просто удалите это письмо.",
      ],
      link: { url: `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`, label: "Подтвердить email" },
    });
    return true;
  } catch (e) {
    console.error("[mail verify]", (e as Error).message);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, token: string, origin: string): Promise<boolean> {
  try {
    await sendMail({
      to: email,
      subject: "Сброс пароля на CryptoPredict",
      paragraphs: [
        "Кто-то (надеемся, вы) попросил сбросить пароль от аккаунта CryptoPredict.",
        "Ссылка действует 1 час и сработает один раз. После смены пароля все устройства выйдут из аккаунта.",
        "Если вы не просили сброс, ничего не делайте — пароль останется прежним.",
      ],
      link: { url: `${origin}/reset-password?token=${encodeURIComponent(token)}`, label: "Задать новый пароль" },
    });
    return true;
  } catch (e) {
    console.error("[mail reset]", (e as Error).message);
    return false;
  }
}
