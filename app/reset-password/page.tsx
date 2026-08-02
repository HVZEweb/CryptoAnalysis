import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">Загрузка...</main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
