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
    uint256 constant MAINNET_FORK_BLOCK = 20_800_000;

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

    bytes32 constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)"
    );

    // ============ STATE VARIABLES ============
    VolatilitySpreadCalculator public calculator;
    uint256 alicePrivateKey = 0xA11CE;
    uint256 bobPrivateKey = 0xB0B;
    address alice;
    address bob;

    // ============ SETUP ============
    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), MAINNET_FORK_BLOCK);

        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);

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

        // Setup volatility feeds
        address[] memory tokens = new address[](3);
        address[] memory priceFeeds = new address[](3);
        bool[] memory isStablecoin = new bool[](3);
        uint256[] memory volatilityOverrides = new uint256[](3);

        tokens[0] = WETH;
        priceFeeds[0] = ETH_USD_FEED;
        isStablecoin[0] = false;
        volatilityOverrides[0] = 0;

        tokens[1] = USDC;
        priceFeeds[1] = USDC_USD_FEED;
        isStablecoin[1] = true;
        volatilityOverrides[1] = 0;

        tokens[2] = DAI;
        priceFeeds[2] = address(0);
        isStablecoin[2] = true;
        volatilityOverrides[2] = 0;

        calculator.addTokenFeeds(tokens, priceFeeds, isStablecoin, volatilityOverrides);
    }

    // function buildOrderWithVolatilitySpread(
    //     address maker,
    //     address makerAsset,
    //     address takerAsset,
    //     uint256 makingAmount,
    //     uint256 takingAmount,
    //     VolatilitySpreadCalculator.SpreadParams memory spreadParams
    // ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory args) {
    //     // Encode spread parameters
    //     bytes memory spreadData = abi.encode(spreadParams);

    //     // Build extension data
    //     bytes memory makingAmountData = abi.encode(spreadData);
    //     bytes memory takingAmountData = abi.encode(spreadData);
    //     // Replace the offset calculation section with:
    //     uint256 makingAmountDataStart = 32;
    //     uint256 takingAmountDataStart = makingAmountDataStart + makingAmountData.length;

    //     // Build extension with proper offsets
    //     // uint256 dataStart = 32; // After offsets
    //     // uint256[] memory offsets = new uint256[](8);

    //     // offsets[0] = makingAmountData.length > 0 ? dataStart : 0;
    //     // offsets[1] = takingAmountData.length > 0 ? dataStart + makingAmountData.length : 0;
    //     // offsets[2] = 0; // predicate
    //     // offsets[3] = 0; // permit
    //     // offsets[4] = 0; // preInteraction
    //     // offsets[5] = 0; // postInteraction
    //     // offsets[6] = 0;
    //     // offsets[7] = 0;

    //     // Pack offsets as 4-byte values
    //     bytes memory offsets = abi.encodePacked(
    //         uint32(makingAmountDataStart),
    //         uint32(takingAmountDataStart),
    //         uint32(takingAmountDataStart + takingAmountData.length), // predicate (empty)
    //         uint32(takingAmountDataStart + takingAmountData.length), // permit (empty)
    //         uint32(takingAmountDataStart + takingAmountData.length), // preInteraction (empty)
    //         uint32(takingAmountDataStart + takingAmountData.length), // postInteraction (empty)
    //         uint32(0),
    //         uint32(0)
    //     );

    //     // // Pack offsets into single uint256
    //     // uint256 packedOffsets = 0;
    //     // for (uint256 i = 0; i < 8; i++) {
    //     //     packedOffsets |= (offsets[i] << (i * 32));
    //     // }

    //     // Build extension
    //     // bytes memory extension = abi.encodePacked(packedOffsets, makingAmountData, takingAmountData);
    //     // Build extension
    //     // bytes memory extension = abi.encodePacked(offsets, makingAmountData, takingAmountData);
    //     // Build the extension data that will be passed to the calculator
    //     bytes memory extension = abi.encodePacked(
    //         address(calculator), // making amount getter
    //         spreadData, // data for making amount
    //         address(calculator), // taking amount getter
    //         spreadData // data for taking amount
    //     );

    //     // Calculate salt from extension hash
    //     // uint256 salt = uint256(keccak256(extension)) & type(uint160).max;
    //     uint256 salt = (uint256(uint160(address(calculator))) << 96);

    //     // Build makerTraits with extension flag
    //     uint256 makerTraitsValue = _ALLOW_MULTIPLE_FILLS_FLAG;

    //     order = ILimitOrderProtocol.Order({
    //         salt: salt,
    //         maker: Address.wrap(uint160(maker)),
    //         receiver: Address.wrap(0),
    //         makerAsset: Address.wrap(uint160(makerAsset)),
    //         takerAsset: Address.wrap(uint160(takerAsset)),
    //         makingAmount: makingAmount,
    //         takingAmount: takingAmount,
    //         makerTraits: MakerTraits.wrap(makerTraitsValue)
    //     });

    //     // For fillOrderArgs, we need to pass the extension as the args parameter
    //     // args = extension;
    //     // For the volatility calculator, we just pass the spread params as args
    //     // args = abi.encode(spreadParams);
    //     // Build args for fillOrderArgs: target + extension + interaction
    //     args = abi.encodePacked(
    //         address(calculator), // target (20 bytes)
    //         extension, // extension data
    //         bytes("") // interaction (empty)
    //     );
    // }

    // function buildOrderWithVolatilitySpread(
    //     address maker,
    //     address makerAsset,
    //     address takerAsset,
    //     uint256 makingAmount,
    //     uint256 takingAmount,
    //     VolatilitySpreadCalculator.SpreadParams memory spreadParams
    // ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory args) {
    //     // Encode spread parameters
    //     bytes memory spreadData = abi.encode(spreadParams);

    //     // Build makingAmountData and takingAmountData
    //     bytes memory makingAmountData = abi.encodePacked(address(calculator), spreadData);
    //     bytes memory takingAmountData = abi.encodePacked(address(calculator), spreadData);

    //     // Build extension with offsets
    //     bytes memory extension;
    //     {
    //         uint256 makingAmountOffset = 0x20; // 32 bytes for offsets
    //         uint256 takingAmountOffset = makingAmountOffset + makingAmountData.length;

    //         // Pack offsets as 32-bit values
    //         bytes memory offsets = abi.encodePacked(
    //             uint32(makingAmountOffset),
    //             uint32(takingAmountOffset),
    //             uint32(takingAmountOffset + takingAmountData.length), // predicate
    //             uint32(takingAmountOffset + takingAmountData.length), // permit
    //             uint32(takingAmountOffset + takingAmountData.length), // preInteraction
    //             uint32(takingAmountOffset + takingAmountData.length), // postInteraction
    //             uint32(0),
    //             uint32(0)
    //         );

    //         extension = abi.encodePacked(offsets, makingAmountData, takingAmountData);
    //     }

    //     // For resolver pattern: salt = (resolver << 96) | extension_offset
    //     // Extension offset in args is after target address (20 bytes)
    //     uint256 salt = (uint256(uint160(address(calculator))) << 96) | 20;

    //     // Build args: target + extension + interaction
    //     args = abi.encodePacked(
    //         address(0), // no target needed for resolver pattern
    //         extension,
    //         bytes("") // no interaction
    //     );

    //     // Build order without extension flag (using resolver pattern)
    //     uint256 makerTraitsValue = _HAS_EXTENSION_FLAG;

    //     order = ILimitOrderProtocol.Order({
    //         salt: salt,
    //         maker: Address.wrap(uint160(maker)),
    //         receiver: Address.wrap(0),
    //         makerAsset: Address.wrap(uint160(makerAsset)),
    //         takerAsset: Address.wrap(uint160(takerAsset)),
    //         makingAmount: makingAmount,
    //         takingAmount: takingAmount,
    //         makerTraits: MakerTraits.wrap(makerTraitsValue)
    //     });
    // }

    // function buildOrderWithVolatilitySpread(
    //     address maker,
    //     address makerAsset,
    //     address takerAsset,
    //     uint256 makingAmount,
    //     uint256 takingAmount,
    //     VolatilitySpreadCalculator.SpreadParams memory spreadParams
    // ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory args) {
    //     // Encode spread parameters
    //     bytes memory spreadData = abi.encode(spreadParams);

    //     // For resolver pattern, makingAmountData and takingAmountData contain the resolver address + data
    //     bytes memory makingAmountData = abi.encodePacked(address(calculator), spreadData);
    //     bytes memory takingAmountData = abi.encodePacked(address(calculator), spreadData);

    //     // Build extension
    //     bytes memory extension;
    //     {
    //         // Calculate cumulative offsets
    //         uint256 offset = 0;
    //         uint256[] memory offsets = new uint256[](8);

    //         // makingAmountData
    //         offsets[0] = offset;
    //         offset += makingAmountData.length;

    //         // takingAmountData
    //         offsets[1] = offset;
    //         offset += takingAmountData.length;

    //         // predicate, permit, preInteraction, postInteraction (all empty)
    //         for (uint256 i = 2; i < 6; i++) {
    //             offsets[i] = offset;
    //         }

    //         // Pack offsets into single uint256
    //         uint256 packedOffsets = 0;
    //         for (uint256 i = 0; i < 8; i++) {
    //             packedOffsets |= (offsets[i] << (32 * i));
    //         }

    //         extension = abi.encodePacked(packedOffsets, makingAmountData, takingAmountData);
    //     }

    //     // Calculate salt from extension hash
    //     uint256 salt = uint256(keccak256(extension)) & type(uint160).max;

    //     // Set makerTraits with HAS_EXTENSION flag
    //     uint256 makerTraitsValue = _HAS_EXTENSION_FLAG | _ALLOW_MULTIPLE_FILLS_FLAG;

    //     order = ILimitOrderProtocol.Order({
    //         salt: salt,
    //         maker: Address.wrap(uint160(maker)),
    //         receiver: Address.wrap(0),
    //         makerAsset: Address.wrap(uint160(makerAsset)),
    //         takerAsset: Address.wrap(uint160(takerAsset)),
    //         makingAmount: makingAmount,
    //         takingAmount: takingAmount,
    //         makerTraits: MakerTraits.wrap(makerTraitsValue)
    //     });

    //     // For fillOrderArgs, args = target (0) + extension + interaction (empty)
    //     args = abi.encodePacked(
    //         address(0), // target (not used with extension)
    //         extension,
    //         bytes("") // interaction
    //     );
    // }

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
        // address (20 bytes) + selector (4 bytes) + arguments
        bytes memory makingAmountGetter =
            abi.encodePacked(address(calculator), calculator.getMakingAmount.selector, spreadData);

        bytes memory takingAmountGetter =
            abi.encodePacked(address(calculator), calculator.getTakingAmount.selector, spreadData);

        // Build extension with proper offsets
        bytes memory extension;
        {
            // Calculate offsets (each is 4 bytes)
            uint32[] memory offsets = new uint32[](8);
            uint32 currentOffset = 32; // Start after offsets

            offsets[0] = 0; // MakerAssetSuffix (empty)
            offsets[1] = 0; // TakerAssetSuffix (empty)
            offsets[2] = currentOffset + uint32(makingAmountGetter.length); // MakingAmountGetter end
            offsets[3] = currentOffset + uint32(makingAmountGetter.length) + uint32(takingAmountGetter.length); // TakingAmountGetter end
            offsets[4] = offsets[3]; // Predicate (empty)
            offsets[5] = offsets[3]; // MakerPermit (empty)
            offsets[6] = offsets[3]; // PreInteraction (empty)
            offsets[7] = offsets[3]; // PostInteraction (empty)

            // Pack offsets as 4-byte values
            bytes memory packedOffsets;
            for (uint256 i = 0; i < 8; i++) {
                packedOffsets = abi.encodePacked(packedOffsets, offsets[i]);
            }

            extension = abi.encodePacked(packedOffsets, makingAmountGetter, takingAmountGetter);
        }

        // Calculate salt: upper 96 bits random + lower 160 bits extension hash
        uint256 extensionHash = uint256(keccak256(extension)) & type(uint160).max;
        uint256 randomSalt = uint256(keccak256(abi.encodePacked(block.timestamp, maker, makingAmount))) >> 160;
        // uint256 salt = (randomSalt << 160) | extensionHash;
        // For resolver pattern, the salt encodes the resolver address
        uint256 salt = (uint256(uint160(address(calculator))) << 96) | 0;

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

        // Args for fillOrderArgs: target + extension + interaction
        // args = abi.encodePacked(
        //     address(0), // no specific target
        //     extension, // the extension data
        //     bytes("") // no taker interaction
        // );
        // And the args would be simpler
        args = spreadData; // Just the spread parameters
    }

    function signOrder(ILimitOrderProtocol.Order memory order, uint256 privateKey)
        internal
        view
        returns (bytes32 r, bytes32 vs)
    {
        // Get the order hash directly from the protocol
        bytes32 orderHash = LIMIT_ORDER_PROTOCOL.hashOrder(order);

        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(privateKey, orderHash);

        // Pack v and s into vs
        vs = bytes32((uint256(v - 27) << 255) | uint256(s));
        r = r_;
    }

    // ============ INTEGRATION TESTS ============
    function testFullOrderFlowWithVolatilitySpread() public {
        // Setup spread parameters
        VolatilitySpreadCalculator.SpreadParams memory params = VolatilitySpreadCalculator.SpreadParams({
            baseSpreadBps: 50,
            volatilityMultiplier: 200,
            maxSpreadBps: 200,
            volatilityWindow: 0,
            useTargetToken: true
        });

        // Preview the spread
        (uint256 volatility, uint256 expectedSpread) = calculator.previewSpread(
            WETH, params.baseSpreadBps, params.volatilityMultiplier, params.maxSpreadBps, params.volatilityWindow
        );
        console.log("Current volatility:", volatility);
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

        // Bob fills the order (with spread applied)
        vm.prank(bob);
        (uint256 makingAmount, uint256 takingAmount,) = LIMIT_ORDER_PROTOCOL.fillOrderArgs(
            order,
            r,
            vs,
            1 ether,
            0, // takerTraits
            args // Pass extension as args
        );

        // Verify balances
        assertEq(WETH.balanceOf(alice), aliceWethBefore - makingAmount, "Alice WETH balance incorrect");
        assertEq(USDC.balanceOf(alice), aliceUsdcBefore + takingAmount, "Alice USDC balance incorrect");
        assertEq(WETH.balanceOf(bob), bobWethBefore + makingAmount, "Bob WETH balance incorrect");
        assertEq(USDC.balanceOf(bob), bobUsdcBefore - takingAmount, "Bob USDC balance incorrect");

        // Verify spread was applied
        uint256 actualSpreadBps = ((takingAmount - 3000 * 1e6) * 10000) / (3000 * 1e6);
        console.log("Actual spread applied (bps):", actualSpreadBps);
        assertEq(actualSpreadBps, expectedSpread, "Spread mismatch");

        // Log results
        console.log("Order filled successfully!");
        console.log("Making amount (WETH):", makingAmount);
        console.log("Taking amount (USDC):", takingAmount);
    }
}
