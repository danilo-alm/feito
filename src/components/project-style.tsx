"use client";
import { useId, useRef, useState, type ReactNode, type SVGProps } from "react";
import { projectStyle, tagColor } from "@/client/colors";
import type { ProjectColor, ProjectIcon } from "@/validation/project-style";
import { hashIconPath, IconCheck, IconChevronDown } from "./icons";
import { Popover } from "./ui";

export const COLOR_OPTIONS: { value: ProjectColor; label: string }[] = [
  { value: "cereja", label: "Cereja" }, { value: "vermelho", label: "Vermelho" }, { value: "coral", label: "Coral" },
  { value: "salmao", label: "Salmão" }, { value: "laranja", label: "Laranja" }, { value: "terracota", label: "Terracota" },
  { value: "ambar", label: "Âmbar" }, { value: "amarelo", label: "Amarelo" }, { value: "oliva", label: "Verde oliva" },
  { value: "limao", label: "Verde limão" }, { value: "verde", label: "Verde" }, { value: "floresta", label: "Verde floresta" },
  { value: "menta", label: "Verde menta" }, { value: "turquesa", label: "Turquesa" }, { value: "petroleo", label: "Azul petróleo" },
  { value: "ceu", label: "Azul céu" }, { value: "azul", label: "Azul" }, { value: "marinho", label: "Azul marinho" },
  { value: "indigo", label: "Índigo" }, { value: "uva", label: "Uva" }, { value: "violeta", label: "Violeta" },
  { value: "lavanda", label: "Lavanda" }, { value: "magenta", label: "Magenta" }, { value: "rosa", label: "Rosa" },
  { value: "marrom", label: "Marrom" }, { value: "taupe", label: "Taupe" }, { value: "grafite", label: "Grafite" },
  { value: "cinza", label: "Cinza" },
];

export const colorValue = (color: ProjectColor) => `var(--proj-${color})`;

const ICON_PATHS: Record<ProjectIcon, { label: string; svg: ReactNode }> = {
  hash: { label: "Hashtag", svg: hashIconPath },
  folder: { label: "Pasta", svg: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> },
  briefcase: { label: "Maleta", svg: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></> },
  home: { label: "Casa", svg: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /> },
  book: { label: "Livro", svg: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /> },
  graduation: { label: "Estudos", svg: <path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" /> },
  bookmark: { label: "Marcador", svg: <path d="M6 3h12v18l-6-4-6 4z" /> },
  pencil: { label: "Lápis", svg: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /> },
  heart: { label: "Coração", svg: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /> },
  star: { label: "Estrela", svg: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /> },
  flag: { label: "Bandeira", svg: <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" /> },
  target: { label: "Alvo", svg: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></> },
  bulb: { label: "Ideia", svg: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /> },
  rocket: { label: "Foguete", svg: <path d="M9 15l-3-3c1.5-5 5-8.5 12-9 -.5 7-4 10.5-9 12zM6 12l-3 .5 2.5-4H9M12 18l-.5 3 4-2.5V15M6.5 17.5C5 19 5 21 5 21s2 0 3.5-1.5" /> },
  trophy: { label: "Troféu", svg: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4.5M16 6h3a3 3 0 0 1-3 4.5M12 13v4M8.5 21h7M10 17h4v4h-4z" /> },
  bolt: { label: "Raio", svg: <path d="M13 3L5 13h6l-1 8 8-10h-6z" /> },
  fire: { label: "Fogo", svg: <path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 5-3 8a6 6 0 0 0 6 6z" /> },
  code: { label: "Código", svg: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /> },
  terminal: { label: "Terminal", svg: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></> },
  chart: { label: "Gráfico", svg: <path d="M5 20V11M10 20V5M15 20v-7M20 20V9M3 20h18" /> },
  wallet: { label: "Carteira", svg: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /></> },
  coin: { label: "Dinheiro", svg: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5" /></> },
  cart: { label: "Compras", svg: <><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></> },
  gift: { label: "Presente", svg: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8C11 5 7 4 7 6.5S10 8 12 8zM12 8c1-3 5-4 5-1.5S14 8 12 8z" /></> },
  plane: { label: "Viagem", svg: <path d="M21 4.5c-.8-.8-2.2-.6-3 .2L14 8.5 5.5 6 4 7.5l7 4-3.5 3.5H5l-1 1 3.5 1.5L9 21l1-1v-2.5l3.5-3.5 4 7 1.5-1.5L16.5 11l3.8-4c.8-.8 1-2.2.2-3z" /> },
  car: { label: "Carro", svg: <path d="M4 16v-4l2.5-5h11L20 12v4zM4 12h16M7 16v2.5M17 16v2.5M7.5 14h.01M16.5 14h.01" /> },
  bike: { label: "Bicicleta", svg: <><circle cx="6" cy="16.5" r="3.5" /><circle cx="18" cy="16.5" r="3.5" /><path d="M6 16.5l4-8h5l3 8M8.5 6H11M12 16.5l3-8" /></> },
  pin: { label: "Lugar", svg: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></> },
  globe: { label: "Mundo", svg: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></> },
  mountain: { label: "Montanha", svg: <path d="M3 20l6.5-11 4 6.5 2.5-3.5L21 20z" /> },
  leaf: { label: "Folha", svg: <path d="M5 19C5 11 10 5 20 5c0 10-6 15-14 15M5 19l7-7" /> },
  plant: { label: "Planta", svg: <path d="M12 21v-8M12 13c-4 0-6.5-3-6.5-6.5 3.5 0 6.5 2.5 6.5 6.5zM12 11c0-4 3-7 7-7 0 4-3 7-7 7M8 21h8" /> },
  sun: { label: "Sol", svg: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" /></> },
  moon: { label: "Lua", svg: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /> },
  cloud: { label: "Nuvem", svg: <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" /> },
  coffee: { label: "Café", svg: <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3" /> },
  utensils: { label: "Comida", svg: <path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10M17 21V3c-2 1-3 4-3 8h3" /> },
  music: { label: "Música", svg: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></> },
  headphones: { label: "Fones", svg: <><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4" height="7" rx="1.5" /><rect x="17" y="14" width="4" height="7" rx="1.5" /></> },
  camera: { label: "Câmera", svg: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></> },
  film: { label: "Vídeo", svg: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></> },
  gamepad: { label: "Jogos", svg: <path d="M7 8h10a5 5 0 0 1 5 5v.5a3 3 0 0 1-5.4 1.8L15 13.5H9l-1.6 1.8A3 3 0 0 1 2 13.5V13a5 5 0 0 1 5-5zM7 10.5v3M5.5 12h3M15.5 11.5h.01M17.5 13h.01" /> },
  palette: { label: "Arte", svg: <><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2s-.8-1.5-.8-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></> },
  dumbbell: { label: "Academia", svg: <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" /> },
  pulse: { label: "Saúde", svg: <path d="M3 12h4l2-5 4 10 2-5h6" /> },
  medical: { label: "Médico", svg: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></> },
  paw: { label: "Pet", svg: <><circle cx="6.5" cy="10" r="1.6" /><circle cx="10" cy="6.5" r="1.6" /><circle cx="14" cy="6.5" r="1.6" /><circle cx="17.5" cy="10" r="1.6" /><path d="M12 12c-3 0-5.5 3.5-5.5 5.5 0 1.5 1.5 2 3 1.5 1-.3 1.7-.5 2.5-.5s1.5.2 2.5.5c1.5.5 3 0 3-1.5C17.5 15.5 15 12 12 12z" /></> },
  smile: { label: "Sorriso", svg: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></> },
  user: { label: "Pessoa", svg: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  users: { label: "Equipe", svg: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></> },
  chat: { label: "Conversa", svg: <path d="M4 5h16v11H9l-5 4z" /> },
  mail: { label: "E-mail", svg: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></> },
  calendar: { label: "Calendário", svg: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></> },
  clock: { label: "Relógio", svg: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
  box: { label: "Caixa", svg: <path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10" /> },
  wrench: { label: "Ferramentas", svg: <path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3a5 5 0 0 0-1-1z" /> },
  shield: { label: "Escudo", svg: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /> },
  lock: { label: "Cadeado", svg: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> },
};

export const ICON_OPTIONS = (Object.keys(ICON_PATHS) as ProjectIcon[]).map((value) => ({ value, label: ICON_PATHS[value].label }));

export function Glyph({ icon, ...rest }: SVGProps<SVGSVGElement> & { icon: ProjectIcon }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {ICON_PATHS[icon]?.svg ?? ICON_PATHS.hash.svg}
    </svg>
  );
}

/** Ícone e cor de um projeto pelo id (lidos da navegação carregada). */
export function ProjectGlyph({ id, className, style }: { id: string | null | undefined; className?: string; style?: React.CSSProperties }) {
  const { icon, color } = projectStyle(id);
  return <Glyph icon={icon} className={className} style={{ color, ...style }} />;
}

/** Campos Cor e Ícone do formulário de projeto: cada um abre uma lista rolável (sem barra visível). */
export function ProjectStyleFields({ projectId, color, icon, disabled, onColor, onIcon }: {
  projectId?: string; color: ProjectColor | null; icon: ProjectIcon; disabled?: boolean;
  onColor: (color: ProjectColor | null) => void; onIcon: (icon: ProjectIcon) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState<"color" | "icon" | null>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const auto = projectId ? tagColor(projectId) : "var(--faint)";
  const current = color ? colorValue(color) : auto;
  const colorName = color ? COLOR_OPTIONS.find((option) => option.value === color)?.label : "Automática";
  const close = () => setOpen(null);

  return (
    <div className="ps-fields">
      <div className="ps-field">
        <span className="lbl" id={`${id}-color`}>Cor</span>
        <button ref={colorRef} type="button" className="inline-input ps-select" disabled={disabled}
          aria-haspopup="listbox" aria-expanded={open === "color"} aria-labelledby={`${id}-color ${id}-color-value`}
          onClick={() => setOpen(open === "color" ? null : "color")}>
          <span className={`ps-dot${color ? "" : " auto"}`} style={{ background: color ? current : undefined }} />
          <span id={`${id}-color-value`} className="ps-value">{colorName}</span>
          <IconChevronDown className="sm" />
        </button>
      </div>
      <div className="ps-field">
        <span className="lbl" id={`${id}-icon`}>Ícone</span>
        <button ref={iconRef} type="button" className="inline-input ps-select ps-icon-btn" disabled={disabled}
          aria-haspopup="listbox" aria-expanded={open === "icon"} aria-labelledby={`${id}-icon ${id}-icon-value`}
          onClick={() => setOpen(open === "icon" ? null : "icon")}>
          <Glyph icon={icon} style={{ color: current }} />
          <span id={`${id}-icon-value`} className="ps-value">{ICON_PATHS[icon].label}</span>
          <IconChevronDown className="sm" />
        </button>
      </div>

      <Popover anchor={colorRef.current} open={open === "color"} onClose={close} label="Cor do projeto" role="listbox" width={260}>
        <div className="ps-list" role="presentation">
          {[{ value: null, label: "Automática" } as { value: ProjectColor | null; label: string }, ...COLOR_OPTIONS].map((option) => {
            const selected = option.value === color;
            return (
              <button key={option.value ?? "auto"} type="button" role="option" aria-selected={selected}
                className={`mi ps-option${selected ? " on" : ""}`} data-autofocus={selected || undefined}
                onClick={() => { onColor(option.value); close(); }}>
                <span className="ps-check">{selected && <IconCheck />}</span>
                <span className={`ps-dot${option.value ? "" : " auto"}`} style={{ background: option.value ? colorValue(option.value) : undefined }} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </Popover>

      <Popover anchor={iconRef.current} open={open === "icon"} onClose={close} label="Ícone do projeto" role="listbox" width={316} align="end">
        <div className="ps-grid" role="presentation">
          {ICON_OPTIONS.map((option) => {
            const selected = option.value === icon;
            return (
              <button key={option.value} type="button" role="option" aria-selected={selected} aria-label={option.label}
                title={option.label} className={`ps-glyph${selected ? " on" : ""}`} data-autofocus={selected || undefined}
                onClick={() => { onIcon(option.value); close(); }}>
                <Glyph icon={option.value} style={{ color: current }} />
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
