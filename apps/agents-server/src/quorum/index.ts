import {
  loadAgents,
  getCoordinator,
  getReporter,
  getQuorumAgents,
} from "../registry.js";
import { spawnAgentRuntime } from "../runtime/agentRuntime.js";
import { makeCoordinatorHandler } from "./coordinator.js";
import { makeMemberHandler } from "./member.js";
import { makeReporterHandler } from "./reporter.js";

export async function bootQuorum(biomeName: string): Promise<() => void> {
  loadAgents(); // ensure registry initialised
  const coordinator = getCoordinator();
  const reporter = getReporter();
  const members = getQuorumAgents();

  if (!coordinator) {
    console.warn("[quorum] no coordinator agent found — quorum disabled");
    return () => {};
  }
  if (!reporter) {
    console.warn("[quorum] no reporter agent found — quorum disabled");
    return () => {};
  }
  if (members.length === 0) {
    console.warn("[quorum] no quorum members found — quorum disabled");
    return () => {};
  }

  console.log(
    `[quorum] booting: coordinator=${coordinator.slug}, reporter=${reporter.slug}, members=[${members.map((m) => m.slug).join(", ")}], biome=${biomeName}`,
  );

  const stops: Array<() => void> = [];

  // Coordinator
  stops.push(
    await spawnAgentRuntime(
      coordinator,
      makeCoordinatorHandler(coordinator, {
        biomeName,
        members,
        reporter,
      }),
    ),
  );

  // Reporter
  stops.push(
    await spawnAgentRuntime(
      reporter,
      makeReporterHandler(reporter, {
        biomeName,
        coordinatorEns: coordinator.ens,
      }),
    ),
  );

  // Members
  for (const m of members) {
    stops.push(
      await spawnAgentRuntime(
        m,
        makeMemberHandler(m, {
          coordinatorEns: coordinator.ens,
          biomeName,
        }),
      ),
    );
  }

  console.log(`[quorum] all ${stops.length} runtimes booted`);
  return () => stops.forEach((s) => s());
}
