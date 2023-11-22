const sdk = require('@defillama/sdk');
const abi = require('./abi.json');

const stakingContractAddress = '0x12F002fb4F5fa9B7dCcd542873F5171B7E176268';
const whiteTokenAddress = '0x39B44F9C6e3ed4F1b4F7b01B9176B1F440195a2f';

async function tvl(timestamp) {
    console.log("Ejecutando la función TVL");
    try {
        const stakedWhiteTokenBalance = await sdk.api.abi.call({
            abi: abi, 
            target: stakingContractAddress,
            params: [], 
            methodName: 'totalStaked' 
        });

        console.log("Saldo de tokens apostados: ", stakedWhiteTokenBalance);
        const balanceInEther = sdk.utils.formatUnits(stakedWhiteTokenBalance.output, 18);
        console.log("Balance en Ether: ", balanceInEther);

        return {
            [whiteTokenAddress]: balanceInEther
        };
    } catch (error) {
        console.error("Error en la función TVL: ", error);
    }
}

module.exports = {
    methodology: 'amount of WTE staked X price of WhiteToken here https://pancakeswap.finance/swap?chain=opBNB&inputCurrency=0x39B44F9C6e3ed4F1b4F7b01B9176B1F440195a2f&outputCurrency=BNB',
    op_bnb: {
        tvl
    }
};