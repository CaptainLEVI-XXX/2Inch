// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {VolatilitySpreadCalculator} from "../src/VolatilitySpreadCalculator.sol";

contract VolatilitySpreadScript is Script {
    VolatilitySpreadCalculator public calculator;

    address owner = address(0x4741b6F3CE01C4ac1C387BC9754F31c1c93866F0);

    // Mainnet addresses
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // Chainlink Price Feeds
    address constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address constant USDC_USD_FEED = 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6;

    function run() public {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(privateKey);
        calculator = new VolatilitySpreadCalculator(owner);
        // Setup volatility feeds with override values for testing
        address[] memory tokens = new address[](3);
        address[] memory priceFeeds = new address[](3);
        bool[] memory isStablecoin = new bool[](3);
        uint256[] memory volatilityOverrides = new uint256[](3);

        tokens[0] = WETH;
        priceFeeds[0] = ETH_USD_FEED;
        isStablecoin[0] = false;
        volatilityOverrides[0] = 2000; // 20% volatility for testing

        tokens[1] = USDC;
        priceFeeds[1] = USDC_USD_FEED;
        isStablecoin[1] = true;
        volatilityOverrides[1] = 0; // Will use default stablecoin volatility

        tokens[2] = DAI;
        priceFeeds[2] = USDC_USD_FEED;
        isStablecoin[2] = true;
        volatilityOverrides[2] = 0;

        calculator.addTokenFeeds(tokens, priceFeeds, isStablecoin, volatilityOverrides);

        vm.stopBroadcast();
    }
}

//source .env && forge script script/VolatilitySpreadScript.s.sol:VolatilitySpreadScript --rpc-url $ETH_RPC_URL --broadcast
