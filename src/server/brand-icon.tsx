import { ImageResponse } from "next/og";
import { BRAND_GREEN, BRAND_PAPER, MARK_PATHS, MARK_STROKE } from "@/components/brand-mark";

// Ícone do app em PNG: símbolo em papel sobre a placa verde.
// `rounded` usa cantos de 22% (ícone comum); sem ele, a placa ocupa tudo (maskable e Apple).
export function brandIconResponse(size: number, { rounded }: { rounded: boolean }) {
  const mark = Math.round(size * 0.575);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: BRAND_GREEN,
            borderRadius: rounded ? size * 0.21875 : 0,
          }}
        >
          <svg
            width={mark}
            height={mark}
            viewBox="0 0 32 32"
            fill="none"
            stroke={BRAND_PAPER}
            strokeWidth={MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {MARK_PATHS.map((d) => <path key={d} d={d} />)}
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
