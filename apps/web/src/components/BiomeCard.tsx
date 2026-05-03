import { Link } from "react-router-dom";

type Props = {
  name: string;
  goal?: string;
  memberCount?: number;
  isOwner?: boolean;
};

export function BiomeCard({ name, goal, memberCount, isOwner }: Props) {
  return (
    <Link
      to={`/biomes/${encodeURIComponent(name)}`}
      className="panel-soft card-hover-flux group block p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold tracking-wide text-gray-100 truncate group-hover:text-flux-200 transition-colors">
            {name}
          </p>
          {goal && (
            <p className="text-xs text-gray-500 line-clamp-2 mt-1 leading-snug">
              {goal}
            </p>
          )}
        </div>
        {isOwner && <span className="pill-flux flex-shrink-0">owner</span>}
      </div>
      <div className="mt-3 flex items-center justify-between">
        {memberCount !== undefined ? (
          <span className="text-[11px] font-mono text-gray-500">
            {memberCount} members
          </span>
        ) : (
          <span />
        )}
        <span className="text-xs font-display uppercase tracking-widest text-flux-300 group-hover:text-flux-200">
          Open →
        </span>
      </div>
    </Link>
  );
}
