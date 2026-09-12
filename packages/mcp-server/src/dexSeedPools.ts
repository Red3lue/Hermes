// Blue-chip pool IDs discovered 2026-09-12 from each deployment's top 100 pools
// by cumulative volume. Fallback only: live discovery replaces them at runtime,
// and every metric (TVL, volume, revenue) is always fetched live.
export const SEED_BLUE_CHIP_POOLS: Readonly<Record<string, readonly string[]>> = {
  "uniswap-v3-ethereum": [
    "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", // Uniswap V3 USD Coin/Wrapped Ether 0.05%
    "0x11b815efb8f581194ae79006d24e0d814b7697f6", // Uniswap V3 Wrapped Ether/Tether USD 0.05%
    "0x3416cf6c708da44db2624d63ea0aaef7113527c6", // Uniswap V3 USD Coin/Tether USD 0.01%
    "0x4585fe77225b41b697c938b018e2ac67ac5a20c0", // Uniswap V3 Wrapped BTC/Wrapped Ether 0.05%
    "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8", // Uniswap V3 USD Coin/Wrapped Ether 0.3%
    "0xc7bbec68d12a0d1830360f8ec58fa599ba1b0e9b", // Uniswap V3 Wrapped Ether/Tether USD 0.01%
    "0x4e68ccd3e89f51c3074ca5072bbac773960dfa36", // Uniswap V3 Wrapped Ether/Tether USD 0.3%
    "0xe0554a476a092703abdb3ef35c80e0d76d32939f", // Uniswap V3 USD Coin/Wrapped Ether 0.01%
    "0xcbcdf9626bc03e24f779434178a73a0b4bad62ed", // Uniswap V3 Wrapped BTC/Wrapped Ether 0.3%
    "0x60594a405d53811d3bc4766596efd80fd545a270", // Uniswap V3 Dai Stablecoin/Wrapped Ether 0.05%
    "0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa", // Uniswap V3 Wrapped liquid staked Ether 2.0/Wrapped Ether 0.01%
    "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35", // Uniswap V3 Wrapped BTC/USD Coin 0.3%
    "0x5777d92f208679db4b9778590fa3cab3ac9e2168", // Uniswap V3 Dai Stablecoin/USD Coin 0.01%
    "0x7858e59e0c01ea06df3af3d20ac7b0003275d4bf", // Uniswap V3 USD Coin/Tether USD 0.05%
    "0x56534741cd8b152df6d48adf7ac51f75169a83b2", // Uniswap V3 Wrapped BTC/Tether USD 0.05%
    "0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8", // Uniswap V3 Dai Stablecoin/Wrapped Ether 0.3%
    "0x9a772018fbd77fcd2d25657e5c547baff3fd7d16", // Uniswap V3 Wrapped BTC/USD Coin 0.05%
    "0x9db9e0e53058c89e5b94e29621a205198648425b", // Uniswap V3 Wrapped BTC/Tether USD 0.3%
    "0x48da0965ab2d2cbf1c17c09cfb5cbe67ad5b1406", // Uniswap V3 Dai Stablecoin/Tether USD 0.01%
    "0x6c6bc977e13df9b0de53b251522280bb72383700", // Uniswap V3 Dai Stablecoin/USD Coin 0.05%
    "0x6f48eca74b38d2936b02ab603ff4e36a6c0e3a77", // Uniswap V3 Dai Stablecoin/Tether USD 0.05%
    "0xe6ff8b9a37b0fab776134636d9981aa778c4e718", // Uniswap V3 Wrapped BTC/Wrapped Ether 0.01%
  ],
  "curve-finance-ethereum": [
    "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7", // Curve.fi DAI/USDC/USDT
    "0xdc24316b9ae028f1497c275eb9192a3ea0f67022", // Curve.fi ETH/stETH
    "0xd51a44d3fae010294c616388b506acda1bfaae46", // Curve.fi USD-BTC-ETH
    "0x4f493b7de8aac7d55f71853688b1f7c8f0243c85", // Curve.fi Strategic USD Reserves
    "0x21e27a5e5513d6e65c4f830167390997aa84843a", // Curve.fi Factory Pool: stETH-ng
    "0x7f86bf177dd4f3494b841a37e810a34dd56c829b", // TricryptoUSDC
    "0x80466c64868e1ab14a1ddf27a676c3fcbe638fe5", // Curve.fi USD-BTC-ETH
    "0xf5f5b97624542d72a9e06f04804bf81baa15e2b4", // TricryptoUSDT
    "0x828b154032950c8ff7cf8085d841723db2696056", // Curve.fi Factory Plain Pool: stETH concentrated
  ],
  "sushiswap-ethereum": [
    "0x397ff1542f962076d0bfe58ea045ffa2d347aca0", // SushiSwap USD Coin/Wrapped Ether
    "0x06da0fd433c1a5d7a4faa01111c044910a184553", // SushiSwap Wrapped Ether/Tether USD
    "0xc3d03e4f041fd4cd388c549ee2a29a9e5075882f", // SushiSwap Dai Stablecoin/Wrapped Ether
    "0xceff51756c56ceffca006cd410b03ffc46dd3a58", // SushiSwap Wrapped BTC/Wrapped Ether
    "0xc5578194d457dcce3f272538d1ad52c68d1ce849", // SushiSwap Dai Stablecoin/Wrapped liquid staked Ether 2.0
  ],
};
