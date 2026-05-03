import { Link } from "react-router-dom";
import { AgentAvatar } from "./AgentAvatar";

type Props = {
  ens: string;
  displayName?: string;
  role?: string;
  pubkey?: string;
  inboxCount?: number;
};

export function AgentCard({ ens, displayName, role, pubkey, inboxCount }: Props) {
  const slug = ens.split(".")[0];
  return (
    <Link
      to={`/agents/${encodeURIComponent(ens)}`}
      className="panel-soft card-hover-cyan group block p-4"
    >
      <div className="flex items-center gap-3">
        <AgentAvatar slug={slug} size={40} />
        <div className="flex-1 min-w-0">
          <p className="font-display text-sm font-semibold tracking-wide text-gray-100 group-hover:text-hermes-200 transition-colors">
            {displayName ?? slug}
          </p>
          <p className="text-[11px] font-mono text-gray-500 truncate">{ens}</p>
        </div>
        {role && <span className="pill-cyan flex-shrink-0">{role}</span>}
      </div>
      {pubkey && (
        <p className="mt-3 text-[11px] font-mono text-gray-600 truncate">
          pubkey · {pubkey.slice(0, 22)}…
        </p>
      )}
      <div className="mt-3 flex items-center justify-between">
        {inboxCount !== undefined ? (
          <span className="text-[11px] font-mono text-gray-500">
            {inboxCount} msgs
          </span>
        ) : (
          <span />
        )}
        <span className="text-xs font-display uppercase tracking-widest text-hermes-300 group-hover:text-hermes-200">
          Open →
        </span>
      </div>
    </Link>
  );
}
