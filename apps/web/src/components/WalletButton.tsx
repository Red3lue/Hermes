import { useWallet } from "@/hooks/useWallet";
import { useAppKit } from "@reown/appkit/react";

export function WalletButton() {
  const { address, isConnected } = useWallet();
  const { open } = useAppKit();

  if (isConnected && address) {
    return (
      <button
        onClick={() => open()}
        className="rounded-md border border-gray-700 px-3 py-1.5 text-sm font-mono text-gray-300 hover:border-hermes-500 hover:text-hermes-300 transition-colors"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  return (
    <button
      onClick={() => open()}
      className="rounded-md bg-hermes-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-hermes-500 transition-colors"
    >
      Connect
    </button>
  );
}
