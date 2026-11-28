"use client";

import { isHexAccent, type HexAccent } from "@feito/core/types";
import { useState, type CSSProperties, type PointerEvent } from "react";
import { fromHsv, toHsv, type Hsv } from "../client/accent-colors";
import { useT } from "./language";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function AccentColorEditor({ initial, onClose, onSave }: {
  initial: HexAccent;
  onClose: () => void;
  onSave: (color: HexAccent) => void;
}) {
  const t = useT();
  const [hsv, setHsv] = useState(() => toHsv(initial));
  const [input, setInput] = useState(() => initial.toUpperCase());
  const valid = isHexAccent(input);
  const color = fromHsv(hsv);

  function update(value: Hsv) {
    setHsv(value);
    setInput(fromHsv(value).toUpperCase());
  }

  function pickPoint(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    update({
      ...hsv,
      saturation: clamp((event.clientX - bounds.left) / bounds.width),
      brightness: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    });
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (valid) onSave(input.toLowerCase() as HexAccent);
    }}>
      <div className="dialog-b accent-editor">
        <div className="accent-plane" aria-hidden="true"
          style={{ "--picker-hue": `hsl(${hsv.hue}, 100%, 50%)` } as CSSProperties}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pickPoint(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) pickPoint(event);
          }}>
          <span style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.brightness) * 100}%`, backgroundColor: color }} />
        </div>
        <label className="accent-channel">
          <span>{t("Matiz")}</span>
          <input className="accent-hue" data-autofocus type="range" min={0} max={359} value={Math.min(359, Math.floor(hsv.hue))}
            onChange={(event) => update({ ...hsv, hue: event.currentTarget.valueAsNumber })} />
        </label>
        <div className="accent-channel-pair">
          <label className="accent-channel">
            <span>{t("Saturação")}</span>
            <input type="range" min={0} max={100} value={Math.round(hsv.saturation * 100)}
              onChange={(event) => update({ ...hsv, saturation: event.currentTarget.valueAsNumber / 100 })} />
          </label>
          <label className="accent-channel">
            <span>{t("Brilho")}</span>
            <input type="range" min={0} max={100} value={Math.round(hsv.brightness * 100)}
              onChange={(event) => update({ ...hsv, brightness: event.currentTarget.valueAsNumber / 100 })} />
          </label>
        </div>
        <label className="field">
          <span className="lbl">{t("Código hexadecimal")}</span>
          <span className="accent-hex">
            <span className="accent-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
            <input className="input" type="text" maxLength={7} autoComplete="off" spellCheck={false}
              aria-invalid={!valid} placeholder="#RRGGBB" value={input}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setInput(value);
                if (isHexAccent(value)) setHsv(toHsv(value, hsv.hue));
              }} />
          </span>
        </label>
      </div>
      <div className="dialog-f">
        <button type="button" className="btn" onClick={onClose}>{t("Cancelar")}</button>
        <button type="submit" className="btn primary" disabled={!valid}>{t("Salvar")}</button>
      </div>
    </form>
  );
}
