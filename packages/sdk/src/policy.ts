export type BiomePolicy = {
  canRead: boolean;
  canPost: boolean;
  canForwardFromPublic: boolean; // public 1:1 → this biome
  canForwardToPublic: boolean; // this biome → public 1:1
  canBridgeToBiome: { [otherBiomeName: string]: boolean };
};

export type PublicPolicy = {
  canReceive: boolean;
  canSend: boolean;
  canStartConversations: boolean; // initiate without prior inbound thread
};

export type AgentPolicy = {
  public: PublicPolicy;
  biomeDefaults: BiomePolicy;
  biomes: { [biomeName: string]: Partial<BiomePolicy> };
};

export type AgentPolicyPatch = {
  public?: Partial<PublicPolicy>;
  biomeDefaults?: Partial<BiomePolicy>;
  biomes?: { [biomeName: string]: Partial<BiomePolicy> | null };
};

export type PolicyChannel =
  | { kind: "public"; peer?: string }
  | { kind: "biome"; name: string };

export type PolicyDeniedReason =
  | "public.canReceive"
  | "public.canSend"
  | "public.canStartConversations"
  | "biome.canRead"
  | "biome.canPost"
  | "bridge.canForwardFromPublic"
  | "bridge.canForwardToPublic"
  | "bridge.canBridgeToBiome";

export class PolicyDeniedError extends Error {
  reason: PolicyDeniedReason;
  channel: PolicyChannel;
  target?: PolicyChannel;
  constructor(opts: {
    reason: PolicyDeniedReason;
    channel: PolicyChannel;
    target?: PolicyChannel;
    message?: string;
  }) {
    super(opts.message ?? `policy denied: ${opts.reason}`);
    this.name = "PolicyDeniedError";
    this.reason = opts.reason;
    this.channel = opts.channel;
    this.target = opts.target;
  }
}

export function defaultPolicy(): AgentPolicy {
  return {
    public: {
      canReceive: true,
      canSend: true,
      canStartConversations: false,
    },
    biomeDefaults: {
      canRead: true,
      canPost: true,
      canForwardFromPublic: false,
      canForwardToPublic: false,
      canBridgeToBiome: {},
    },
    biomes: {},
  };
}

export function resolveBiomePolicy(
  policy: AgentPolicy,
  biomeName: string,
): BiomePolicy {
  const override = policy.biomes[biomeName] ?? {};
  return {
    canRead: override.canRead ?? policy.biomeDefaults.canRead,
    canPost: override.canPost ?? policy.biomeDefaults.canPost,
    canForwardFromPublic:
      override.canForwardFromPublic ??
      policy.biomeDefaults.canForwardFromPublic,
    canForwardToPublic:
      override.canForwardToPublic ?? policy.biomeDefaults.canForwardToPublic,
    canBridgeToBiome: {
      ...policy.biomeDefaults.canBridgeToBiome,
      ...(override.canBridgeToBiome ?? {}),
    },
  };
}

export function mergePolicy(
  base: AgentPolicy,
  patch: AgentPolicyPatch,
): AgentPolicy {
  const next: AgentPolicy = {
    public: { ...base.public, ...(patch.public ?? {}) },
    biomeDefaults: {
      ...base.biomeDefaults,
      ...(patch.biomeDefaults ?? {}),
      canBridgeToBiome: {
        ...base.biomeDefaults.canBridgeToBiome,
        ...(patch.biomeDefaults?.canBridgeToBiome ?? {}),
      },
    },
    biomes: { ...base.biomes },
  };
  if (patch.biomes) {
    for (const [name, override] of Object.entries(patch.biomes)) {
      if (override === null) {
        delete next.biomes[name];
        continue;
      }
      const prev = next.biomes[name] ?? {};
      const merged: Partial<BiomePolicy> = { ...prev, ...override };
      if (override.canBridgeToBiome) {
        merged.canBridgeToBiome = {
          ...(prev.canBridgeToBiome ?? {}),
          ...override.canBridgeToBiome,
        };
      }
      next.biomes[name] = merged;
    }
  }
  return next;
}

export type SendCheckCtx = {
  channel: { kind: "public"; peer: string } | { kind: "biome"; name: string };
  /** Only consulted when `channel.kind === "public"`. */
  hasPriorInbound?: boolean;
};

export function assertSendAllowed(
  policy: AgentPolicy,
  ctx: SendCheckCtx,
): void {
  if (ctx.channel.kind === "public") {
    if (!policy.public.canSend) {
      throw new PolicyDeniedError({
        reason: "public.canSend",
        channel: ctx.channel,
      });
    }
    if (!policy.public.canStartConversations && !ctx.hasPriorInbound) {
      throw new PolicyDeniedError({
        reason: "public.canStartConversations",
        channel: ctx.channel,
      });
    }
    return;
  }
  const bp = resolveBiomePolicy(policy, ctx.channel.name);
  if (!bp.canPost) {
    throw new PolicyDeniedError({
      reason: "biome.canPost",
      channel: ctx.channel,
    });
  }
}

export type ReceiveCheckCtx = {
  channel: { kind: "public" } | { kind: "biome"; name: string };
};

export function assertReceiveAllowed(
  policy: AgentPolicy,
  ctx: ReceiveCheckCtx,
): void {
  if (ctx.channel.kind === "public") {
    if (!policy.public.canReceive) {
      throw new PolicyDeniedError({
        reason: "public.canReceive",
        channel: ctx.channel,
      });
    }
    return;
  }
  const bp = resolveBiomePolicy(policy, ctx.channel.name);
  if (!bp.canRead) {
    throw new PolicyDeniedError({
      reason: "biome.canRead",
      channel: ctx.channel,
    });
  }
}

export type BridgeChannel =
  | { kind: "public"; peer?: string }
  | { kind: "biome"; name: string };

export type BridgeCheckCtx = {
  from: BridgeChannel;
  to: BridgeChannel;
};

export function assertBridgeAllowed(
  policy: AgentPolicy,
  ctx: BridgeCheckCtx,
): void {
  const { from, to } = ctx;

  if (from.kind === "public" && to.kind === "biome") {
    const bp = resolveBiomePolicy(policy, to.name);
    if (!bp.canForwardFromPublic) {
      throw new PolicyDeniedError({
        reason: "bridge.canForwardFromPublic",
        channel: from,
        target: to,
      });
    }
    return;
  }

  if (from.kind === "biome" && to.kind === "public") {
    const bp = resolveBiomePolicy(policy, from.name);
    if (!bp.canForwardToPublic) {
      throw new PolicyDeniedError({
        reason: "bridge.canForwardToPublic",
        channel: from,
        target: to,
      });
    }
    return;
  }

  if (from.kind === "biome" && to.kind === "biome") {
    const bp = resolveBiomePolicy(policy, from.name);
    if (!bp.canBridgeToBiome[to.name]) {
      throw new PolicyDeniedError({
        reason: "bridge.canBridgeToBiome",
        channel: from,
        target: to,
      });
    }
    return;
  }

  // public → public is just a normal send; bridge() will dispatch through
  // assertSendAllowed for that path. No bridge-specific check needed.
}
