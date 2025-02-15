const ADDRESSES = require("../helper/coreAssets.json");
const {
  sumTokens2,
  genericUnwrapCvxDeposit,
  unwrapCreamTokens,
} = require("../helper/unwrapLPs.js");
const {
  getStargateLpValues,
  getCompoundUsdcValues,
  _getLogs,
} = require("./helper");

const chainConfigs = {
  ethereum: {
    deployerAddresses: [
      "0xFd6CC4F251eaE6d02f9F7B41D1e80464D3d2F377",
      "0x5c46b718Cd79F2BBA6869A3BeC13401b9a4B69bB",
    ],
    rsr: "0x320623b8E4fF03373931769A31Fc52A4E78B5d70",
    vault: "0xaedcfcdd80573c2a312d15d6bb9d921a01e4fb0f",
    fromBlock: 16680995,
    erc4626Wrapped: [
      '0xaa91d24c2f7dbb6487f61869cd8cd8afd5c5cab2',
    ]
  },
  base: {
    deployerAddresses: [
      "0xf1B06c2305445E34CF0147466352249724c2EAC1",
      "0x9C75314AFD011F22648ca9C655b61674e27bA4AC",
    ],
    rsr: "0xab36452dbac151be02b16ca17d8919826072f64a",
    fromBlock: 5000000,
  },
};

async function tvl(_time, block, _, { api, chain }) {
  const config = chainConfigs[chain];
  let { erc4626Wrapped = [] } = config;
  erc4626Wrapped = erc4626Wrapped.map(i => i.toLowerCase())
  // Common logic for calculating TVL (only mainnet has vault)
  const ownerTokens = config.vault
    ? [
      [
        [
          ADDRESSES.ethereum.USDC, //usdc
          "0x8e870d67f660d95d5be530380d0ec0bd388289e1", //pax
          ADDRESSES.ethereum.TUSD, //tusd
          ADDRESSES.ethereum.BUSD, //busd
        ],
        config.vault,
      ],
    ]
    : [];
  const blacklistedTokens = [config.rsr];
  const fluxListWithOwner = [];
  const creationLogs = await _getLogs(api, config);

  const mains = creationLogs.map((i) => i.main);
  const rTokens = creationLogs.map((i) => i.rToken);

  const backingManagers = await api.multiCall({
    abi: "address:backingManager",
    calls: mains,
  });
  const basketHandlers = await api.multiCall({
    abi: "address:basketHandler",
    calls: mains,
  });
  const basketRes = await api.multiCall({
    abi: "function quote(uint192, uint8) view returns (address[], uint256[])",
    calls: basketHandlers.map((i) => ({ target: i, params: [0, 0] })),
  });

  let processedWrappers = new Set();
  const allTokens = basketRes.flatMap(([tokens], i) => {
    ownerTokens.push([tokens, rTokens[i]]);
    ownerTokens.push([tokens, backingManagers[i]]);
    return tokens;
  });
  const allRTokens = basketRes.flatMap(([tokens], i) =>
    tokens.map(() => rTokens[i])
  );
  const allManagers = basketRes.flatMap(([tokens], i) =>
    tokens.map(() => backingManagers[i])
  );
  const allNames = await api.multiCall({
    abi: "string:name",
    calls: allTokens,
  });

  const aTokenWrappers = allTokens.filter((_, i) =>
    allNames[i].startsWith("Static Aave")
  );
  const cUsdcV3Wrapper = allTokens.find((_, i) =>
    allNames[i].startsWith("Wrapped cUSDCv3")
  );
  const stargateLpWrappers = allTokens.filter((_, i) =>
    allNames[i].startsWith("Wrapped Stargate")
  );
  const cTokenWrappers = allTokens.filter(
    (_, i) => /^Compound.*Vault$/.test(allNames[i]) // Starts with Compound, ends with Vault
  );
  const convexTokensAndOwners = [];
  const erc4626TokensAndOwners = []

  allTokens.forEach((token, i) => {
    if (!allNames[i].startsWith("Flux ")) return;
    fluxListWithOwner.push([token, allRTokens[i]]);
    fluxListWithOwner.push([token, allManagers[i]]);
    blacklistedTokens.push(token);
    return true;
  });

  allTokens.forEach((token, i) => {
    if (!allNames[i].endsWith("Convex Deposit")) return;
    blacklistedTokens.push(token);
    convexTokensAndOwners.push([token, allRTokens[i]]);
    convexTokensAndOwners.push([token, allManagers[i]]);
  });

  allTokens.forEach((token, i) => {
    token = token.toLowerCase()
    if (!erc4626Wrapped.includes(token)) return;
    blacklistedTokens.push(token);
    erc4626TokensAndOwners.push([token, allRTokens[i]]);
    erc4626TokensAndOwners.push([token, allManagers[i]]);
  });

  let cTokens = await api.multiCall({
    abi: "address:underlying",
    calls: cTokenWrappers,
  });

  let aTokens = await api.multiCall({
    abi: api.chain === "base" ? "address:aToken" : "address:ATOKEN",
    calls: aTokenWrappers,
  });
  blacklistedTokens.push(
    ...aTokenWrappers,
    ...stargateLpWrappers,
    ...cTokenWrappers
  );
  cTokens.forEach((v, i) => ownerTokens.push([[v], cTokenWrappers[i]]));
  aTokens.forEach((v, i) => ownerTokens.push([[v], aTokenWrappers[i]]));

  if (stargateLpWrappers.length)
    await getStargateLpValues(
      api,
      stargateLpWrappers,
      processedWrappers
    );

  if (cUsdcV3Wrapper) {
    blacklistedTokens.push(cUsdcV3Wrapper);
    await getCompoundUsdcValues(
      api,
      cUsdcV3Wrapper,
      processedWrappers
    );
  }

  await Promise.all(
    convexTokensAndOwners.map(([token, owner]) =>
      genericUnwrapCvxDeposit({ api, token, owner })
    )
  );

  await unwrapCreamTokens(api.getBalances(), fluxListWithOwner, api.block);

  if (erc4626TokensAndOwners.length) {
    const erc4626Tokens = erc4626TokensAndOwners.map(([token]) => token)
    const assets = await api.multiCall({ abi: "address:asset", calls: erc4626Tokens })
    const bals = await api.multiCall({ abi: 'uint256:totalAssets', calls: erc4626Tokens })
    const totalSupplies = await api.multiCall({ abi: 'uint256:totalSupply', calls: erc4626Tokens })
    const balances = await api.multiCall({ abi: 'erc20:balanceOf', calls: erc4626TokensAndOwners.map(i => ({ target: i[0], params: i[1] })) })
    balances.forEach((bal, i) => api.add(assets[i], bal * bals[i] / totalSupplies[i]))
  }

  await sumTokens2({ api, ownerTokens, blacklistedTokens });
}

async function staking(_time, block, _, { api, chain }) {
  const config = chainConfigs[chain]; // Load the config for the specified chain
  const creationLogs = await _getLogs(api, config);
  const stRsrs = creationLogs.map((i) => i.stRSR);
  return sumTokens2({ api, owners: stRsrs, tokens: [config.rsr] });
}

module.exports = {
  ethereum: {
    tvl,
    staking,
  },
  base: {
    tvl,
    staking,
  },
  methodology: `TVL accounts for the underlying ERC20 collateral which back RTokens.`,
};
