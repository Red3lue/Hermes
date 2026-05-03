type Props = {
  size?: number;
  className?: string;
  /** When true, render the larger hero version with orbiting particles. */
  hero?: boolean;
};

/**
 * Stylized neon wing — Hermes brand mark. Renders with both cyan and magenta
 * gradient strokes plus a soft drop-shadow halo. The `hero` variant adds
 * orbital rings + particles for the landing page.
 */
export function WingLogo({ size = 28, className, hero = false }: Props) {
  const id = hero ? "wing-hero" : "wing-mark";
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5cd9ff" />
          <stop offset="55%" stopColor="#2cc7ff" />
          <stop offset="100%" stopColor="#c454ff" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(44,199,255,0.55)" />
          <stop offset="60%" stopColor="rgba(44,199,255,0.12)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={hero ? 3.2 : 1.4} />
        </filter>
      </defs>

      {hero && (
        <>
          {/* Halo */}
          <circle cx="100" cy="100" r="92" fill={`url(#${id}-glow)`} />
          {/* Orbital ring */}
          <ellipse
            cx="100"
            cy="100"
            rx="86"
            ry="32"
            fill="none"
            stroke="rgba(44,199,255,0.35)"
            strokeWidth="1"
            transform="rotate(-18 100 100)"
          />
          <ellipse
            cx="100"
            cy="100"
            rx="78"
            ry="24"
            fill="none"
            stroke="rgba(196,84,255,0.35)"
            strokeWidth="1"
            transform="rotate(22 100 100)"
          />
          {/* Particles */}
          {[
            [22, 110],
            [180, 88],
            [154, 156],
            [44, 60],
            [120, 24],
          ].map(([cx, cy], i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={i % 2 === 0 ? 1.6 : 1}
              fill={i % 3 === 0 ? "#c454ff" : "#5cd9ff"}
              opacity="0.85"
            />
          ))}
        </>
      )}

      {/* Glow pass behind the wing */}
      <g filter={`url(#${id}-blur)`} opacity={hero ? 0.85 : 0.6}>
        <WingShape stroke={`url(#${id}-grad)`} strokeWidth={hero ? 4 : 3} />
      </g>
      {/* Sharp pass on top */}
      <g>
        <WingShape stroke={`url(#${id}-grad)`} strokeWidth={hero ? 1.6 : 1.4} />
      </g>
    </svg>
  );
}

function WingShape({
  stroke,
  strokeWidth,
}: {
  stroke: string;
  strokeWidth: number;
}) {
  // Hand-drawn "winged sandal" pattern: a central spine + 6 feathered curves.
  const feathers: string[] = [
    // upper short (closest to spine)
    "M100 100 C 110 86, 124 76, 140 70",
    "M100 100 C 116 84, 138 70, 162 60",
    "M100 100 C 122 80, 152 64, 184 50",
    "M100 100 C 118 92, 142 92, 168 92",
    "M100 100 C 116 110, 142 116, 172 116",
    "M100 100 C 112 120, 130 138, 152 152",
  ];
  return (
    <g
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    >
      {/* Spine */}
      <path d="M100 40 L100 160" />
      {/* Right wing feathers */}
      {feathers.map((d, i) => (
        <path key={`r${i}`} d={d} />
      ))}
      {/* Left wing — mirrored */}
      {feathers.map((d, i) => (
        <path key={`l${i}`} d={d} transform="matrix(-1 0 0 1 200 0)" />
      ))}
      {/* Tip dots */}
      <circle cx="100" cy="40" r="2.4" fill={stroke} />
      <circle cx="100" cy="160" r="2.4" fill={stroke} />
    </g>
  );
}
