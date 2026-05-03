import { HermesNav } from "./HermesNav";

type Crumb = { label: string; to?: string };

type Props = {
  crumbs?: Crumb[];
  compact?: boolean;
  rightSlot?: React.ReactNode;
  /** When true the page fills the viewport with no scroll on the shell itself
   *  (used for chat-style demos that own their own scroll). */
  full?: boolean;
  children: React.ReactNode;
};

export function HermesShell({
  crumbs,
  compact,
  rightSlot,
  full,
  children,
}: Props) {
  return (
    <div
      className={
        full
          ? "flex h-screen flex-col overflow-hidden text-gray-100"
          : "min-h-screen text-gray-100"
      }
    >
      {/* Decorative background grid + radial glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-hermes-grid opacity-40"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[60vh] bg-radial-fade"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[60vh] bg-radial-flux"
      />
      <HermesNav crumbs={crumbs} compact={compact} rightSlot={rightSlot} />
      {full ? (
        <div className="flex flex-1 overflow-hidden">{children}</div>
      ) : (
        <main>{children}</main>
      )}
    </div>
  );
}
