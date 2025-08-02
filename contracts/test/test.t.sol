// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {VolatilitySpreadCalculator} from "../src/VolatilitySpreadCalculator.sol";
import {SafeTransferLib} from "@solady/utils/SafeTransferLib.sol";
import {AddressLib, Address} from "../src/libraries/AddressLib.sol";
import {MakerTraits, MakerTraitsLib} from "../src/libraries/MakerTraitLib.sol";
import {IOrderMixin} from "../src/interfaces/IAmountGetter.sol";

/**
 * @title VolatilitySpreadTest
 * @notice This test demonstrates local testing of the volatility spread calculator without 1inch integration
 */
contract VolatilitySpreadTest is Test {
    using SafeTransferLib for address;
    using MakerTraitsLib for MakerTraits;

    // ============ CONSTANTS ============
    uint256 constant MAINNET_FORK_BLOCK = 20_800_000;

    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // Try a different protocol address or deploy our own mock
    address constant LIMIT_ORDER_PROTOCOL = 0x111111125421cA6dc452d289314280a0f8842A65;

    // ============ STATE VARIABLES ============
    VolatilitySpreadCalculator public calculator;

    address alice;
    address bob;
    uint256 aliceKey;
    uint256 bobKey;

    // ============ SETUP ============
    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), MAINNET_FORK_BLOCK);

        // Create test accounts
        aliceKey = 0x1234567890123456789012345678901234567890123456789012345678901234;
        bobKey = 0x2345678901234567890123456789012345678901234567890123456789012345;

        alice = vm.addr(aliceKey);
        bob = vm.addr(bobKey);

        vm.label(alice, "Alice");
        vm.label(bob, "Bob");

        // Deploy calculator
        calculator = new VolatilitySpreadCalculator(address(this));

        // Setup tokens
        deal(WETH, alice, 100 ether);
        deal(USDC, bob, 1_000_000 * 1e6);

        // Setup volatility
        address[] memory tokens = new address[](2);
        address[] memory priceFeeds = new address[](2);
        bool[] memory isStablecoin = new bool[](2);
        uint256[] memory volatilityOverrides = new uint256[](2);

        tokens[0] = WETH;
        volatilityOverrides[0] = 2000; // 20% volatility

        tokens[1] = USDC;
        isStablecoin[1] = true;

        calculator.addTokenFeeds(tokens, priceFeeds, isStablecoin, volatilityOverrides);
    }

    /**
     * @notice Test volatility spread calculation without 1inch integration
     */
    function testVolatilitySpreadCalculation() public view {
        // Setup spread parameters
        VolatilitySpreadCalculator.SpreadParams memory params = VolatilitySpreadCalculator.SpreadParams({
            baseSpreadBps: 50, // 0.5% base
            volatilityMultiplier: 200, // 2x multiplier
            maxSpreadBps: 300, // 3% max
            volatilityWindow: 0, // 24h
            useTargetToken: true // Use maker asset (WETH)
        });

        // Preview the spread
        (uint256 volatility, uint256 spread) = calculator.previewSpread(
            WETH, params.baseSpreadBps, params.volatilityMultiplier, params.maxSpreadBps, params.volatilityWindow
        );

        console.log("WETH Volatility (bps): ", volatility);
        console.log("Dynamic Spread (bps):", spread);

        // Expected: 50 base + (20% * 2) = 50 + 40 = 90 bps
        assertEq(spread, 90, "Spread calculation incorrect");

        // Test with USDC (stablecoin)
        (uint256 usdcVol, uint256 usdcSpread) = calculator.previewSpread(
            USDC, params.baseSpreadBps, params.volatilityMultiplier, params.maxSpreadBps, params.volatilityWindow
        );

        console.log("USDC Volatility (bps):", usdcVol);
        console.log("USDC Spread (bps):", usdcSpread);

        // Expected: 50 base + (1% * 2) = 50 + 2 = 52 bps
        assertEq(usdcSpread, 52, "USDC spread calculation incorrect");
    }

    /**
     * @notice Demonstrate order creation with volatility spread
     */
    function testOrderCreationWithSpread() public view {
        // Create spread parameters
        VolatilitySpreadCalculator.SpreadParams memory params = VolatilitySpreadCalculator.SpreadParams({
            baseSpreadBps: 50,
            volatilityMultiplier: 200,
            maxSpreadBps: 300,
            volatilityWindow: 0,
            useTargetToken: true
        });

        // Calculate expected amounts
        uint256 makingAmount = 1 ether;
        uint256 baseTakingAmount = 3000 * 1e6;

        // Get current spread
        (, uint256 spreadBps) = calculator.previewSpread(
            WETH, params.baseSpreadBps, params.volatilityMultiplier, params.maxSpreadBps, params.volatilityWindow
        );

        // Calculate taking amount with spread
        uint256 takingAmountWithSpread = baseTakingAmount + (baseTakingAmount * spreadBps / 10000);

        console.log("Order Details:");
        console.log("- Making Amount (WETH):", makingAmount);
        console.log("- Base Taking Amount (USDC):", baseTakingAmount);
        console.log("- Spread (bps):", spreadBps);
        console.log("- Taking Amount with Spread:", takingAmountWithSpread);
        console.log("- Additional USDC due to spread:", takingAmountWithSpread - baseTakingAmount);
    }

    /**
     * @notice Test the amount getter functions directly
     */
    function testAmountGetters() public view {
        // Create a mock order
        IOrderMixin.Order memory order = IOrderMixin.Order({
            salt: 0,
            maker: Address.wrap(uint160(alice)),
            receiver: Address.wrap(0),
            makerAsset: Address.wrap(uint160(WETH)),
            takerAsset: Address.wrap(uint160(USDC)),
            makingAmount: 1 ether,
            takingAmount: 3000 * 1e6,
            makerTraits: MakerTraits.wrap(0)
        });

        // Encode spread params
        bytes memory spreadData = abi.encode(
            VolatilitySpreadCalculator.SpreadParams({
                baseSpreadBps: 50,
                volatilityMultiplier: 200,
                maxSpreadBps: 300,
                volatilityWindow: 0,
                useTargetToken: true
            })
        );

        // Test getTakingAmount
        uint256 takingAmount = calculator.getTakingAmount(
            order,
            "", // extension
            bytes32(0), // orderHash
            bob, // taker
            1 ether, // makingAmount
            1 ether, // remainingMakingAmount
            spreadData // extraData
        );

        console.log("Taking amount with spread:", takingAmount);
        assertGt(takingAmount, 3000 * 1e6, "Taking amount should include spread");

        // Test getMakingAmount
        uint256 makingAmount = calculator.getMakingAmount(
            order,
            "", // extension
            bytes32(0), // orderHash
            bob, // taker
            takingAmount, // takingAmount
            1 ether, // remainingMakingAmount
            spreadData // extraData
        );

        console.log("Making amount for taking amount:", makingAmount);
        // Due to spread, maker would receive less than 1 ETH if taker provides exact taking amount
        assertLt(makingAmount, 1 ether, "Making amount should be reduced by spread");
    }
}
