"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { NavigationProvider } from "@feito/ui/navigation";

export function WebNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  return <NavigationProvider pathname={pathname} router={router} Link={Link}>{children}</NavigationProvider>;
}
