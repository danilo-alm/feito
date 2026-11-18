import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Senha" };

export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
