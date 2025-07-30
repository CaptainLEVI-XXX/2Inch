// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {VolatilitySpreadCalculator} from "../src/VolatilitySpreadCalculator.sol";
import {IOrderMixin} from "../src/interfaces/IAmountGetter.sol";
import {SafeTransferLib} from "@solady/utils/SafeTransferLib.sol";
import {AddressLib, Address} from "../src/libraries/AddressLib.sol";
import {MakerTraits, MakerTraitsLib} from "../src/libraries/MakerTraitLib.sol";

interface ILimitOrderProtocol {
    struct Order {
        uint256 salt;
        Address maker;
        Address receiver;
        Address makerAsset;
        Address takerAsset;
        uint256 makingAmount;
        uint256 takingAmount;
        MakerTraits makerTraits;
    }

    function fillOrderArgs(
        Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        uint256 takerTraits,
        bytes calldata fillOrderArgs
    ) external payable returns (uint256, uint256, bytes32);

    function hashOrder(Order calldata order) external view returns (bytes32);
}

contract IntegrationTest is Test {
    using SafeTransferLib for address;
    using MakerTraitsLib for MakerTraits;

    // ============ CONSTANTS ============
    uint256 constant MAINNET_FORK_BLOCK = 23020785;

    // Mainnet addresses
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // 1inch Limit Order Protocol V4
    ILimitOrderProtocol constant LIMIT_ORDER_PROTOCOL = ILimitOrderProtocol(0x111111125421cA6dc452d289314280a0f8842A65);

    // Chainlink Price Feeds
    address constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address constant USDC_USD_FEED = 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6;

    // 1inch Protocol Constants
    uint256 private constant _MAKER_AMOUNT_FLAG = 1 << 255;
    uint256 private constant _HAS_EXTENSION_FLAG = 1 << 249;
    uint256 private constant _ALLOW_MULTIPLE_FILLS_FLAG = 1 << 254;

    // ============ STATE VARIABLES ============
    VolatilitySpreadCalculator public calculator;

    // Use Foundry's default test accounts with known private keys
    uint256 alicePrivateKey = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 bobPrivateKey = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    address alice;
    address bob;

    // ============ SETUP ============
    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), MAINNET_FORK_BLOCK);

        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);

        console.log("Alice address:", alice);
        console.log("Bob address:", bob);

        calculator = new VolatilitySpreadCalculator(address(this));

        deal(WETH, alice, 100 ether);
        deal(USDC, alice, 1_000_000 * 1e6);
        deal(DAI, alice, 1_000_000 * 1e18);
        deal(WETH, bob, 100 ether);
        deal(USDC, bob, 1_000_000 * 1e6);

        vm.prank(alice);
        WETH.safeApprove(address(LIMIT_ORDER_PROTOCOL), type(uint256).max);
        vm.prank(alice);
        USDC.safeApprove(address(LIMIT_ORDER_PROTOCOL), type(uint256).max);
        vm.prank(alice);
        DAI.safeApprove(address(LIMIT_ORDER_PROTOCOL), type(uint256).max);

        vm.prank(bob);
        WETH.safeApprove(address(LIMIT_ORDER_PROTOCOL), type(uint256).max);
        vm.prank(bob);
        USDC.safeApprove(address(LIMIT_ORDER_PROTOCOL), type(uint256).max);

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
        priceFeeds[2] = address(0);
        isStablecoin[2] = true;
        volatilityOverrides[2] = 0;

        calculator.addTokenFeeds(tokens, priceFeeds, isStablecoin, volatilityOverrides);
    }

    function buildOrderWithVolatilitySpread(
        address maker,
        address makerAsset,
        address takerAsset,
        uint256 makingAmount,
        uint256 takingAmount,
        VolatilitySpreadCalculator.SpreadParams memory spreadParams
    ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory args) {
        // Encode spread parameters
        bytes memory spreadData = abi.encode(spreadParams);

        // Build making/taking amount getters according to 1inch format:
        // Address (20 bytes) + Selector (4 bytes) + Packed arguments
        bytes memory makingAmountGetter =
            abi.encodePacked(address(calculator), calculator.getMakingAmount.selector, spreadData);

        bytes memory takingAmountGetter =
            abi.encodePacked(address(calculator), calculator.getTakingAmount.selector, spreadData);

        // Build extension with proper offsets
        bytes memory extension;
        {
            // Calculate cumulative offsets
            uint32 offset = 32; // Start after offsets header

            // Pack offsets as 4-byte values
            bytes memory packedOffsets = abi.encodePacked(
                uint32(0), // MakerAssetSuffix (empty)
                uint32(0), // TakerAssetSuffix (empty)
                uint32(offset + makingAmountGetter.length), // MakingAmountGetter end offset
                uint32(offset + makingAmountGetter.length + takingAmountGetter.length), // TakingAmountGetter end offset
                uint32(offset + makingAmountGetter.length + takingAmountGetter.length), // Predicate (empty)
                uint32(offset + makingAmountGetter.length + takingAmountGetter.length), // MakerPermit (empty)
                uint32(offset + makingAmountGetter.length + takingAmountGetter.length), // PreInteraction (empty)
                uint32(offset + makingAmountGetter.length + takingAmountGetter.length) // PostInteraction (empty)
            );

            extension = abi.encodePacked(packedOffsets, makingAmountGetter, takingAmountGetter);
        }

        // Calculate salt: upper 96 bits random + lower 160 bits extension hash
        uint256 extensionHash = uint256(keccak256(extension)) & type(uint160).max;
        uint256 randomSalt = uint256(keccak256(abi.encodePacked(block.timestamp, maker, makingAmount))) >> 160;
        uint256 salt = (randomSalt << 160) | extensionHash;

        // Build order with extension flag
        uint256 makerTraitsValue = _HAS_EXTENSION_FLAG | _ALLOW_MULTIPLE_FILLS_FLAG;

        order = ILimitOrderProtocol.Order({
            salt: salt,
            maker: Address.wrap(uint160(maker)),
            receiver: Address.wrap(0),
            makerAsset: Address.wrap(uint160(makerAsset)),
            takerAsset: Address.wrap(uint160(takerAsset)),
            makingAmount: makingAmount,
            takingAmount: takingAmount,
            makerTraits: MakerTraits.wrap(makerTraitsValue)
        });

        // Args for fillOrderArgs: extension data
        args = extension;
    }

    function signOrder(ILimitOrderProtocol.Order memory order, uint256 privateKey)
        internal
        view
        returns (bytes32 r, bytes32 vs)
    {
        // Get the order hash directly from the protocol
        bytes32 orderHash = LIMIT_ORDER_PROTOCOL.hashOrder(order);
        // bytes32 orderHash =

        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(privateKey, orderHash);

        // Pack v and s into vs according to 1inch format
        vs = bytes32((uint256(v - 27) << 255) | uint256(s));
        r = r_;
    }

    // ============ INTEGRATION TESTS ============
    function testFullOrderFlowWithVolatilitySpread() public {
        // Setup spread parameters
        VolatilitySpreadCalculator.SpreadParams memory params = VolatilitySpreadCalculator.SpreadParams({
            baseSpreadBps: 50, // 0.5% base spread
            volatilityMultiplier: 200, // 2x multiplier
            maxSpreadBps: 200, // 2% max spread
            volatilityWindow: 0, // Use 24h volatility
            useTargetToken: true // Use makerAsset (WETH) for volatility
        });

        // Preview the spread
        (uint256 volatility, uint256 expectedSpread) = calculator.previewSpread(
            WETH, params.baseSpreadBps, params.volatilityMultiplier, params.maxSpreadBps, params.volatilityWindow
        );
        console.log("Current volatility (bps):", volatility);
        console.log("Expected spread (bps):", expectedSpread);

        // Build order: Alice sells 1 WETH for USDC
        (ILimitOrderProtocol.Order memory order, bytes memory args) =
            buildOrderWithVolatilitySpread(alice, WETH, USDC, 1 ether, 3000 * 1e6, params);

        // Sign order
        (bytes32 r, bytes32 vs) = signOrder(order, alicePrivateKey);

        // Record balances before
        uint256 aliceWethBefore = WETH.balanceOf(alice);
        uint256 aliceUsdcBefore = USDC.balanceOf(alice);
        uint256 bobWethBefore = WETH.balanceOf(bob);
        uint256 bobUsdcBefore = USDC.balanceOf(bob);

        console.log("\nBalances before fill:");
        console.log("Alice WETH:", aliceWethBefore);
        console.log("Alice USDC:", aliceUsdcBefore);
        console.log("Bob WETH:", bobWethBefore);
        console.log("Bob USDC:", bobUsdcBefore);

        // Bob fills the order (with spread applied)
        vm.prank(bob);
        (uint256 makingAmount, uint256 takingAmount,) = LIMIT_ORDER_PROTOCOL.fillOrderArgs(
            order,
            r,
            vs,
            1 ether, // Fill full amount
            0, // takerTraits
            args // Pass extension as args
        );

        console.log("\nFill results:");
        console.log("Making amount (WETH):", makingAmount);
        console.log("Taking amount (USDC):", takingAmount);

        // Verify balances
        assertEq(WETH.balanceOf(alice), aliceWethBefore - makingAmount, "Alice WETH balance incorrect");
        assertEq(USDC.balanceOf(alice), aliceUsdcBefore + takingAmount, "Alice USDC balance incorrect");
        assertEq(WETH.balanceOf(bob), bobWethBefore + makingAmount, "Bob WETH balance incorrect");
        assertEq(USDC.balanceOf(bob), bobUsdcBefore - takingAmount, "Bob USDC balance incorrect");

        // Verify spread was applied
        uint256 baseAmount = 3000 * 1e6;
        uint256 actualSpreadBps = ((takingAmount - baseAmount) * 10000) / baseAmount;
        console.log("Actual spread applied (bps):", actualSpreadBps);
        assertEq(actualSpreadBps, expectedSpread, "Spread mismatch");

        // Verify the spread increased the taking amount
        assertGt(takingAmount, 3000 * 1e6, "Taking amount should be higher due to spread");

        console.log("\nOrder filled successfully with volatility spread!");
    }
}
