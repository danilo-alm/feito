import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { label?: string };

function make(paths: React.ReactNode, fill = false) {
  return function Icon({ label, className, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={[fill ? "fill" : "", className].filter(Boolean).join(" ") || undefined}
        aria-hidden={label ? undefined : true}
        role={label ? "img" : undefined}
        aria-label={label}
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconCheck = make(<path d="M6 12.5l4 4 8-9" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconInbox = make(<><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>);
export const IconToday = make(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /><path d="M10 15h4" /></>);
export const IconUpcoming = make(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2" /></>);
export const IconCalendar = make(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const IconHash = make(<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />);
export const IconTag = make(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>);
export const IconFlag = make(<path d="M5 21V4h11l-2 4 2 4H5" />);
export const IconRepeat = make(<><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>);
export const IconSub = make(<><path d="M5 4v7a4 4 0 0 0 4 4h10" /><path d="M15 11l4 4-4 4" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconChevronUp = make(<path d="M6 15l6-6 6 6" />);
export const IconChevronLeft = make(<path d="M15 6l-6 6 6 6" />);
export const IconChevronRight = make(<path d="M9 6l6 6-6 6" />);
export const IconMore = make(<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>, true);
export const IconGrip = make(<><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>, true);
export const IconList = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 12h8M8 15h8" /></>);
export const IconBoard = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9.3 4v16M14.7 4v16" /></>);
export const IconTable = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16M4 15h16M10 10v10" /></>);
export const IconSliders = make(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>);
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconArchive = make(<><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10h14V9M10 13h4" /></>);
export const IconMove = make(<><path d="M4 12h12M12 7l5 5-5 5" /><path d="M20 5v14" /></>);
export const IconTrash = make(<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />);
export const IconArrowUp = make(<path d="M12 19V5M6 11l6-6 6 6" />);
export const IconArrowDown = make(<path d="M12 5v14M6 13l6 6 6-6" />);
export const IconPromote = make(<><path d="M19 20v-7a4 4 0 0 0-4-4H5" /><path d="M9 13L5 9l4-4" /></>);
export const IconBan = make(<><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>);
export const IconAlert = make(<><circle cx="12" cy="12" r="8" /><path d="M12 8v5M12 16v.1" /></>);
export const IconHelp = make(<><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 1.9-2.2 3.2M12 16.6v.1" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" /></>);
export const IconMoon = make(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />);
export const IconMonitor = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
export const IconDownload = make(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IconUpload = make(<path d="M12 20V9M7 13l5-5 5 5M5 4h14" />);
export const IconEdit = make(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const IconLogout = make(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />);

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden="true">
      <IconCheck style={{ width: size * 0.6, height: size * 0.6 }} />
    </span>
  );
}
