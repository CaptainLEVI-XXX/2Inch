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
    uint256 public constant MAINNET_FORK_BLOCK = 23020785;

    // Mainnet tokens
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // 1inch Limit Order Protocol V4 Mainnet address
    ILimitOrderProtocol public constant LIMIT_ORDER_PROTOCOL = ILimitOrderProtocol(0x111111125421cA6dc452d289314280a0f8842A65);

    // Chainlink Price Feeds (for your setup)
    address public constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address public constant USDC_USD_FEED = 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6;

    // 1inch Protocol Flags
    uint256 private constant _HAS_EXTENSION_FLAG = 1 << 249;
    uint256 private constant _ALLOW_MULTIPLE_FILLS_FLAG = 1 << 254;

    // Volatility spread calculator instance
    VolatilitySpreadCalculator public calculator;

    // Test accounts private keys
    uint256 _alicePrivateKey = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 _bobPrivateKey = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address public alice;
    address public bob;

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), MAINNET_FORK_BLOCK);

        alice = vm.addr(_alicePrivateKey);
        bob = vm.addr(_bobPrivateKey);

        console.log("Alice address:", alice);
        console.log("Bob address:", bob);

        calculator = new VolatilitySpreadCalculator(address(this));

        // Fund alice and bob
        deal(WETH, alice, 100 ether);
        deal(USDC, alice, 1_000_000 * 1e6);
        deal(DAI, alice, 1_000_000 * 1e18);

        deal(WETH, bob, 100 ether);
        deal(USDC, bob, 1_000_000 * 1e6);

        // Approvals for the Limit Order Protocol
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

        // Setup volatility feeds (dummy setup for test)
        address[] memory tokens = new address[](3);
        address[] memory priceFeeds = new address[](3);
        bool[] memory isStablecoin = new bool[](3);
        uint256[] memory volatilityOverrides = new uint256[](3);

        tokens[0] = WETH;
        priceFeeds[0] = ETH_USD_FEED;
        isStablecoin[0] = false;
        volatilityOverrides[0] = 2000; // 20% for testing

        tokens[1] = USDC;
        priceFeeds[1] = USDC_USD_FEED;
        isStablecoin[1] = true;
        volatilityOverrides[1] = 0; // use default

        tokens[2] = DAI;
        priceFeeds[2] = address(0);
        isStablecoin[2] = true;
        volatilityOverrides[2] = 0;

        calculator.addTokenFeeds(tokens, priceFeeds, isStablecoin, volatilityOverrides);
    }

    function _buildOrderWithVolatilitySpread(
        address maker,
        address makerAsset,
        address takerAsset,
        uint256 makingAmount,
        uint256 takingAmount,
        VolatilitySpreadCalculator.SpreadParams memory spreadParams
    ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory extension, uint256 takerTraits) {
        // Encode parameters using ABI encoding
        bytes memory encodedParams = abi.encode(spreadParams);

        // Build getter data: just address, the protocol will append selector + params
        bytes memory makingAmountData = abi.encodePacked(address(calculator), encodedParams);

        bytes memory takingAmountData = abi.encodePacked(address(calculator), encodedParams);

        // Calculate cumulative offsets for each extension
        uint256 offset1 = makingAmountData.length;
        uint256 offset2 = offset1 + takingAmountData.length;

        // Pack offsets as one uint256 (8 x uint32)
        uint256 packedOffsets = (uint256(0) << (32 * 0)) // makerAssetSuffix offset
            | (uint256(0) << (32 * 1)) // takerAssetSuffix offset
            | (uint256(offset1) << (32 * 2)) // makingAmountGetter offset
            | (uint256(offset2) << (32 * 3)) // takingAmountGetter offset
            | (uint256(offset2) << (32 * 4)) // predicate offset
            | (uint256(offset2) << (32 * 5)) // permit offset
            | (uint256(offset2) << (32 * 6)) // preInteraction offset
            | (uint256(offset2) << (32 * 7)); // postInteraction offset

        // Build extension: offsets (32 bytes) + data
        extension = abi.encodePacked(bytes32(packedOffsets), makingAmountData, takingAmountData);

        // Calculate salt
        uint256 extensionHash = uint256(keccak256(extension)) & ((1 << 160) - 1);
        uint256 randomSalt = uint256(keccak256(abi.encodePacked(block.timestamp, maker, makingAmount))) >> 160;
        uint256 salt = (randomSalt << 160) | extensionHash;

        // Build maker traits
        uint256 makerTraitsValue = _HAS_EXTENSION_FLAG | _ALLOW_MULTIPLE_FILLS_FLAG;

        order = ILimitOrderProtocol.Order({
            salt: salt,
            maker: Address.wrap(uint160(maker)),
            receiver: Address.wrap(uint160(maker)),
            makerAsset: Address.wrap(uint160(makerAsset)),
            takerAsset: Address.wrap(uint160(takerAsset)),
            makingAmount: makingAmount,
            takingAmount: takingAmount,
            makerTraits: MakerTraits.wrap(makerTraitsValue)
        });

        // Build taker traits
        uint256 makerAmountFlag = 1 << 255;
        uint256 extensionLengthBits = uint256(extension.length) << 224;
        takerTraits = makerAmountFlag | extensionLengthBits;
    }

    function _signOrder(ILimitOrderProtocol.Order memory order, uint256 privateKey)
        internal
        view
        returns (bytes32 r, bytes32 vs)
    {
        bytes32 orderHash = LIMIT_ORDER_PROTOCOL.hashOrder(order);
        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(privateKey, orderHash);

        // Pack v and s into vs according to 1inch format
        vs = bytes32((uint256(v - 27) << 255) | uint256(s));
        r = r_;
    }

    function testFullOrderFlowWithVolatilitySpread() public {
        VolatilitySpreadCalculator.SpreadParams memory params = VolatilitySpreadCalculator.SpreadParams({
            baseSpreadBps: 50,
            volatilityMultiplier: 200,
            maxSpreadBps: 200,
            volatilityWindow: 0,
            useTargetToken: true
        });

        (ILimitOrderProtocol.Order memory order, bytes memory extension, uint256 takerTraits) =
            _buildOrderWithVolatilitySpread(alice, WETH, USDC, 1 ether, 3000 * 1e6, params);

        (bytes32 r, bytes32 vs) = _signOrder(order, _alicePrivateKey);

        // Verify extension hash
        uint256 expectedHash = uint256(keccak256(extension)) & ((1 << 160) - 1);
        uint256 saltHash = order.salt & ((1 << 160) - 1);
        console.log("Expected extension hash:", expectedHash);
        console.log("Salt extension hash:", saltHash);
        assertEq(expectedHash, saltHash, "Extension hash mismatch");

        // Record balances before fill
        uint256 aliceWethBefore = WETH.balanceOf(alice);
        uint256 aliceUsdcBefore = USDC.balanceOf(alice);
        uint256 bobWethBefore = WETH.balanceOf(bob);
        uint256 bobUsdcBefore = USDC.balanceOf(bob);

        console.log("\nBalances before fill:");
        console.log("Alice WETH:", aliceWethBefore);
        console.log("Alice USDC:", aliceUsdcBefore);
        console.log("Bob WETH:", bobWethBefore);
        console.log("Bob USDC:", bobUsdcBefore);

        // Perform order fill as Bob (taker)
        vm.prank(bob);
        (uint256 makingAmount, uint256 takingAmount,) = LIMIT_ORDER_PROTOCOL.fillOrderArgs(
            order,
            r,
            vs,
            1 ether, // Fill exact making amount
            takerTraits,
            extension // Pass the extension as args
        );

        console.log("\nFill results:");
        console.log("Making amount (WETH):", makingAmount);
        console.log("Taking amount (USDC):", takingAmount);

        // Verify balances updated correctly
        assertEq(WETH.balanceOf(alice), aliceWethBefore - makingAmount, "Alice WETH balance incorrect");
        assertEq(USDC.balanceOf(alice), aliceUsdcBefore + takingAmount, "Alice USDC balance incorrect");
        assertEq(WETH.balanceOf(bob), bobWethBefore + makingAmount, "Bob WETH balance incorrect");
        assertEq(USDC.balanceOf(bob), bobUsdcBefore - takingAmount, "Bob USDC balance incorrect");

        // Verify spread was applied
        uint256 baseAmount = 3000 * 1e6;
        require(takingAmount >= baseAmount, "Taking amount should be >= base");

        uint256 actualSpreadBps = ((takingAmount - baseAmount) * 10000) / baseAmount;
        console.log("Actual spread applied (bps):", actualSpreadBps);

        console.log("\nOrder filled successfully with volatility spread!");
    }
}
