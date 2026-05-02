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
        backgroundColor: bg,
        color: text,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        fontFamily: "monospace",
        flexShrink: 0,
        userSelect: "none",
      }}
      title={slug}
    >
      {initials(slug)}
    </div>
  );
}
