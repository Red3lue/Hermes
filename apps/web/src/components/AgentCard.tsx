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
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <AgentAvatar slug={slug} size={36} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{displayName ?? slug}</p>
          <p className="text-xs font-mono text-gray-500 truncate">{ens}</p>
        </div>
        {role && (
          <span className="text-xs rounded border border-gray-700 text-gray-500 px-1.5 py-0.5">
            {role}
          </span>
        )}
      </div>
      {pubkey && (
        <p className="text-xs font-mono text-gray-700 truncate">pubkey: {pubkey.slice(0, 20)}…</p>
      )}
      <div className="flex items-center justify-between">
        {inboxCount !== undefined && (
          <span className="text-xs font-mono text-gray-600">{inboxCount} msgs</span>
        )}
        <Link
          to={`/agents/${encodeURIComponent(ens)}`}
          className="ml-auto text-sm text-hermes-400 hover:text-hermes-300 transition-colors"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}
