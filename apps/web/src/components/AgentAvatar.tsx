import { avatarColors, initials } from "@/lib/avatar";

type Props = {
  slug: string;
  size?: number;
};

export function AgentAvatar({ slug, size = 32 }: Props) {
  const { bg, text } = avatarColors(slug);
  return (
    <div
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 25%, ${bg} 0%, rgba(0,0,0,0.45) 110%)`,
        color: text,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        fontFamily: "'Orbitron', monospace",
        letterSpacing: "0.04em",
        flexShrink: 0,
        userSelect: "none",
        boxShadow:
          "0 0 0 1px rgba(44,199,255,0.35), 0 0 12px rgba(44,199,255,0.18)",
      }}
      title={slug}
    >
      {initials(slug)}
    </div>
  );
}
