"use client";

import { createContext, useContext, useMemo, type ComponentProps, type ComponentType, type ReactNode } from "react";

type LinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };
type Router = { push: (href: string) => void; replace: (href: string) => void };
type Navigation = { pathname: string; router: Router; Link: ComponentType<LinkProps> };

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ pathname, router, Link, children }: Navigation & { children: ReactNode }) {
  const value = useMemo(() => ({ pathname, router, Link }), [pathname, router, Link]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

function useNavigation() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("Provedor de navegação indisponível.");
  return navigation;
}

export function usePathname() {
  return useNavigation().pathname;
}

export function useRouter() {
  return useNavigation().router;
}

export function Link(props: LinkProps) {
  const { Link: PlatformLink } = useNavigation();
  return <PlatformLink {...props} />;
}
