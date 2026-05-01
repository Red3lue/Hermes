import { Link } from "react-router-dom";
import { WalletButton } from "@/components/WalletButton";

export default function BiomeNew() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link to="/biomes" className="text-gray-400 text-sm hover:text-gray-200">
          biomes
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 text-sm">new biome</span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-gray-400">
          BIOME creation — coming soon. Will generate symmetric K, wrap it per member, upload
          BiomeDoc to 0G, and register the ENS subname.
        </p>
      </div>
    </div>
  );
}
