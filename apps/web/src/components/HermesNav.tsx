import { Link, useLocation } from "react-router-dom";
import { WingLogo } from "./WingLogo";
import { WalletButton } from "./WalletButton";

type Crumb = { label: string; to?: string };

type Props = {
  /** Optional breadcrumb tail rendered after the brand. */
  crumbs?: Crumb[];
  /** When true, hides the marketing nav links (used inside demo pages). */
  compact?: boolean;
  /** Slot for right-aligned status pills before the wallet button. */
  rightSlot?: React.ReactNode;
};

const links: { to: string; label: string; hash?: string }[] = [
  { to: "/", label: "Tech Stack", hash: "#tech-stack" },
  { to: "/", label: "Features", hash: "#features" },
  { to: "/demos", label: "Live Demo" },
];

export function HermesNav({ crumbs, compact, rightSlot }: Props) {
  const loc = useLocation();
  const isHome = loc.pathname === "/";
  return (
    <nav className="sticky top-0 z-40 border-b border-hermes-700/30 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4">
        <Link
          to="/"
          className="flex items-center gap-2.5 group"
          aria-label="Hermes home"
        >
          <span className="text-hermes-300 group-hover:text-hermes-200 transition-colors animate-pulse-neon">
            <WingLogo size={26} />
          </span>
          <span className="font-display text-xl font-bold tracking-[0.18em] text-gray-100">
            HERMES
          </span>
        </Link>

        {crumbs && crumbs.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-2">
                <span className="text-hermes-700">/</span>
                {c.to ? (
                  <Link
                    to={c.to}
                    className="hover:text-hermes-300 transition-colors"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-gray-300 font-medium">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          {!compact && (
            <div className="hidden md:flex items-center gap-5 mr-3">
              {links.map((l) => {
                const href = isHome && l.hash ? l.hash : l.to;
                const Comp: any = isHome && l.hash ? "a" : Link;
                const props = isHome && l.hash ? { href } : { to: href };
                return (
                  <Comp
                    key={l.label}
                    {...props}
                    className="font-display text-xs uppercase tracking-[0.22em] text-gray-400 hover:text-hermes-300 transition-colors"
                  >
                    {l.label}
                  </Comp>
                );
              })}
            </div>
          )}
          {rightSlot}
          <Link
            to="/dashboard"
            className="hidden sm:inline-flex font-display text-xs uppercase tracking-[0.22em] text-gray-400 hover:text-hermes-300 transition-colors px-2 py-1"
          >
            Dashboard
          </Link>
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
