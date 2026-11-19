import { brandIconResponse } from "@/server/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// O iOS arredonda os cantos sozinho, então a placa ocupa a imagem inteira.
export default function AppleIcon() {
  return brandIconResponse(180, { rounded: false });
}
