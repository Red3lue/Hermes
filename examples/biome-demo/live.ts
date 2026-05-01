import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";

import {
  Hermes,
  ZeroGStorage,
  createBiome,
  joinBiome,
  removeMember,
  generateKeyPairFromSignature,
  saveKeystore,
  type StorageConfig,
  type BiomeContext,
  type Keystore,
} from "../../packages/sdk/src";

type AgentRig = {
  ens: string;
  wallet: WalletClient & { account: Account };
  publicClient: PublicClient;
  hermes: Hermes;
  keystorePath: string;
};

function short(hex: string, n = 10): string {
  if (hex.length <= 2 * n + 2) return hex;
  return `${hex.slice(0, n + 2)}…${hex.slice(-n)}`;
}

function step(label: string) {
  console.log(`\n[step] ${label}`);
  console.log("-".repeat(72));
}

function ok(msg: string) {
  console.log(`  [OK]   ${msg}`);
}

function info(msg: string) {
  console.log(`  [info] ${msg}`);
}

function reqEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.startsWith("0x...") || v === "yourdomain.eth") {
    throw new Error(`env ${key} is missing or unset`);
  }
  return v;
}

async function buildAgent(
  ens: string,
  privateKey: `0x${string}`,
  inboxContract: `0x${string}`,
  rpcUrl: string,
  storageCfg: StorageConfig,
  tmpDir: string,
): Promise<AgentRig> {
  const account = privateKeyToAccount(privateKey);
  const chain = addEnsContracts(sepolia);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  }) as unknown as PublicClient;
  const wallet = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account,
  }) as WalletClient & { account: Account };

  // Pre-derive X25519 keys and seed a keystore so Hermes uses the same keys
  // we'll use for the free createBiome/removeMember calls.
  const keys = await generateKeyPairFromSignature(wallet, 1);
  const keystorePath = join(tmpDir, `${ens.replace(/\./g, "_")}.json`);
  const ks: Keystore = {
    ensName: ens,
    address: account.address,
    keyVersion: 1,
    x25519: keys,
  };
  saveKeystore(keystorePath, ks);

  const hermes = new Hermes({
    ensName: ens,
    inboxContract,
    publicClient,
    wallet,
    storage: storageCfg,
    keystorePath,
  });

  return { ens, wallet, publicClient, hermes, keystorePath };
}

async function biomeCtxFor(rig: AgentRig, storage: ZeroGStorage): Promise<BiomeContext> {
  // Hermes already loaded the same keys from the keystore we seeded; we can
  // re-load them via `register()`, but since publishing ENS records is
  // expensive in gas we skip it if records already exist. Just rebuild ctx
  // from the keystore-derived keys.
  const keys = await generateKeyPairFromSignature(rig.wallet, 1);
  return {
    publicClient: rig.publicClient,
    wallet: rig.wallet,
    storage,
    myEns: rig.ens,
    myKeys: keys,
  };
}

export async function runLiveDemo(): Promise<void> {
  const SEPOLIA_RPC = reqEnv("SEPOLIA_RPC_URL");
  const ZG_RPC = reqEnv("ZEROG_RPC_URL");
  const ZG_INDEXER = reqEnv("ZEROG_INDEXER_URL");
  const INBOX = reqEnv("HERMES_INBOX_CONTRACT") as `0x${string}`;

  const ALICE_PK = reqEnv("HERMES_ALICE_PRIVATE_KEY") as `0x${string}`;
  const BOB_PK = reqEnv("HERMES_BOB_PRIVATE_KEY") as `0x${string}`;
  const CAROL_PK = reqEnv("HERMES_CAROL_PRIVATE_KEY") as `0x${string}`;

  const ALICE_ENS = reqEnv("HERMES_ALICE_ENS");
  const BOB_ENS = reqEnv("HERMES_BOB_ENS");
  const CAROL_ENS = reqEnv("HERMES_CAROL_ENS");
  const BIOME_ENS =
    process.env.HERMES_BIOME_ENS ?? `demo.${reqEnv("HERMES_PARENT_ENS")}`;

  const storageCfg: StorageConfig = {
    rpcUrl: ZG_RPC,
    indexerUrl: ZG_INDEXER,
    privateKey: ALICE_PK,
  };
  const storageAlice = new ZeroGStorage(storageCfg);
  const storageBob = new ZeroGStorage({ ...storageCfg, privateKey: BOB_PK });
  const storageCarol = new ZeroGStorage({ ...storageCfg, privateKey: CAROL_PK });

  const tmpDir = mkdtempSync(join(tmpdir(), "hermes-biome-demo-"));
  info(`scratch keystore dir: ${tmpDir}`);

  try {
    step("0. Build agent rigs (Sepolia clients + 0G storage + Hermes SDK)");
    const alice = await buildAgent(ALICE_ENS, ALICE_PK, INBOX, SEPOLIA_RPC, storageCfg, tmpDir);
    const bob = await buildAgent(BOB_ENS, BOB_PK, INBOX, SEPOLIA_RPC, {
      ...storageCfg,
      privateKey: BOB_PK,
    }, tmpDir);
    const carol = await buildAgent(CAROL_ENS, CAROL_PK, INBOX, SEPOLIA_RPC, {
      ...storageCfg,
      privateKey: CAROL_PK,
    }, tmpDir);
    ok(`alice = ${alice.wallet.account.address}`);
    ok(`bob   = ${bob.wallet.account.address}`);
    ok(`carol = ${carol.wallet.account.address}`);

    step("1. Each agent publishes hermes.pubkey records via register()");
    info("(skipped automatically if records already match — but each call costs gas)");
    if (process.env.SKIP_REGISTER !== "1") {
      await alice.hermes.register();
      ok(`${ALICE_ENS} registered`);
      await bob.hermes.register();
      ok(`${BOB_ENS} registered`);
      await carol.hermes.register();
      ok(`${CAROL_ENS} registered`);
    } else {
      info("SKIP_REGISTER=1 set; assuming ENS records already published");
    }

    step(`2. Alice creates biome ${BIOME_ENS} with all three members`);
    const aliceCtx = await biomeCtxFor(alice, storageAlice);
    const created = await createBiome(aliceCtx, {
      name: BIOME_ENS,
      goal: "hermes v0.2 lifecycle demo",
      members: [
        { ens: ALICE_ENS, pubkey: aliceCtx.myKeys.publicKey },
        { ens: BOB_ENS, pubkey: (await biomeCtxFor(bob, storageBob)).myKeys.publicKey },
        { ens: CAROL_ENS, pubkey: (await biomeCtxFor(carol, storageCarol)).myKeys.publicKey },
      ],
    });
    ok(`biome doc root = ${short(created.root)} version=${created.version}`);

    step("3. Bob and Carol joinBiome — verify they derive the same K");
    const bobCtx = await biomeCtxFor(bob, storageBob);
    const carolCtx = await biomeCtxFor(carol, storageCarol);
    const bobJoin = await joinBiome(bobCtx, BIOME_ENS);
    const carolJoin = await joinBiome(carolCtx, BIOME_ENS);
    if (Buffer.from(bobJoin.K).toString("hex") !== Buffer.from(created.K).toString("hex")) {
      throw new Error("bob derived a different K");
    }
    if (Buffer.from(carolJoin.K).toString("hex") !== Buffer.from(created.K).toString("hex")) {
      throw new Error("carol derived a different K");
    }
    ok("bob and carol both unwrapped the same K");

    step("4. Bob sends a biome message via client.sendToBiome");
    const sent = await bob.hermes.sendToBiome(BIOME_ENS, "hello biome — bob, live on Sepolia");
    ok(`uploaded envelope ${short(sent.rootHash)} via tx ${short(sent.tx)}`);
    if (sent.historyRoot) ok(`history manifest ${short(sent.historyRoot)}`);

    step("5. Alice and Carol fetchBiomeInbox — decrypt + verify");
    // Brief settle so the inbox log is queryable.
    await new Promise((r) => setTimeout(r, 6_000));
    const aliceMsgs = await alice.hermes.fetchBiomeInbox(BIOME_ENS);
    const carolMsgs = await carol.hermes.fetchBiomeInbox(BIOME_ENS);
    ok(`alice fetched ${aliceMsgs.length} message(s); latest: "${aliceMsgs.at(-1)?.text}"`);
    ok(`carol fetched ${carolMsgs.length} message(s); latest: "${carolMsgs.at(-1)?.text}"`);

    step(`6. Alice removes Carol — version bumps, fresh K rotated`);
    const removed = await removeMember(aliceCtx, BIOME_ENS, CAROL_ENS);
    ok(`new biome root ${short(removed.root)} version=${removed.version}`);

    step("7. Bob posts post-removal; Carol's old K cannot decrypt");
    // Force the SDK to re-fetch the biome doc + new K on next send/fetch.
    const bob2 = await buildAgent(BOB_ENS, BOB_PK, INBOX, SEPOLIA_RPC, {
      ...storageCfg,
      privateKey: BOB_PK,
    }, tmpDir);
    const carol2 = await buildAgent(CAROL_ENS, CAROL_PK, INBOX, SEPOLIA_RPC, {
      ...storageCfg,
      privateKey: CAROL_PK,
    }, tmpDir);

    const sent2 = await bob2.hermes.sendToBiome(BIOME_ENS, "post-removal: only survivors");
    ok(`bob uploaded post-removal envelope ${short(sent2.rootHash)}`);

    await new Promise((r) => setTimeout(r, 6_000));
    let carolGotIt = false;
    try {
      const carolMsgs2 = await carol2.hermes.fetchBiomeInbox(BIOME_ENS);
      carolGotIt = carolMsgs2.some((m) => m.rootHash === sent2.rootHash);
    } catch {
      // joinBiome inside fetchBiomeInbox should fail because Carol has no wrap.
    }
    if (carolGotIt) {
      throw new Error("SECURITY: removed Carol decrypted a post-removal envelope");
    }
    ok("carol failed to decrypt post-removal envelope (expected)");

    const aliceMsgs2 = await alice.hermes.fetchBiomeInbox(BIOME_ENS);
    const lastForAlice = aliceMsgs2.at(-1);
    if (!lastForAlice) throw new Error("alice saw no post-removal message");
    ok(`alice decrypted with new K: "${lastForAlice.text}"`);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}
