import { Link } from "react-router-dom";

type Props = {
  name: string;
  goal?: string;
  memberCount?: number;
  isOwner?: boolean;
};

export function BiomeCard({ name, goal, memberCount, isOwner }: Props) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{name}</p>
          {goal && <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{goal}</p>}
        </div>
        {isOwner && (
          <span className="flex-shrink-0 text-xs rounded border border-hermes-800 text-hermes-400 px-1.5 py-0.5">
            owner
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        {memberCount !== undefined && (
          <span className="text-xs font-mono text-gray-600">{memberCount} members</span>
        )}
        <Link
          to={`/biomes/${encodeURIComponent(name)}`}
          className="ml-auto text-sm text-hermes-400 hover:text-hermes-300 transition-colors"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}
