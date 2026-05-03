import { useWallet } from "@/hooks/useWallet";
import { useAppKit } from "@reown/appkit/react";

export function WalletButton() {
  const { address, isConnected } = useWallet();
  const { open } = useAppKit();

  if (isConnected && address) {
    return (
      <button
        onClick={() => open()}
        className="rounded-md border border-hermes-500/40 bg-ink-900/60 px-3 py-1.5 text-xs font-mono text-hermes-200 hover:border-hermes-400 hover:text-hermes-100 hover:shadow-neon-cyan transition-all"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-mint-400 align-middle shadow-neon-mint" />
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  return (
    <button onClick={() => open()} className="btn-neon !px-4 !py-2 !text-xs">
      Connect
    </button>
  );
}
