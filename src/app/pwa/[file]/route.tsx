import { brandIconResponse } from "@/server/brand-icon";

const ICONS = {
  "icon-192.png": { size: 192, rounded: true },
  "icon-512.png": { size: 512, rounded: true },
  "maskable-512.png": { size: 512, rounded: false },
} as const;

type IconFile = keyof typeof ICONS;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const icon = ICONS[file as IconFile];
  if (!icon) return new Response("Not found", { status: 404 });
  return brandIconResponse(icon.size, { rounded: icon.rounded });
}
