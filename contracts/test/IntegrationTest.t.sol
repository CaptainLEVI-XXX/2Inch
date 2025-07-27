// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {VolatilitySpreadCalculator} from "../src/VolatilitySpreadCalculator.sol";
import {IOrderMixin} from "../src/interfaces/IAmountGetter.sol";
import {SafeTransferLib} from "@solady/utils/SafeTransferLib.sol";

interface ILimitOrderProtocol {
    struct Order {
        uint256 salt;
        address maker;
        address receiver;
        address makerAsset;
        address takerAsset;
        uint256 makingAmount;
        uint256 takingAmount;
        uint256 makerTraits;
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

    // ============ CONSTANTS ============

    // forked block
    uint256 constant MAINET_FORK_BLOCK = 20_500_000;

    // Mainnet addresses
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;

    // 1inch Limit Order Protocol V4
    ILimitOrderProtocol constant LIMIT_ORDER_PROTOCOL = ILimitOrderProtocol(0x111111125421cA6dc452d289314280a0f8842A65);

    // Chainlink Feeds (using price feeds as mock volatility)
    address constant ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address constant USDC_USD_FEED = 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6;
    address constant ETH_USD_24hr_FEED = 0x31D04174D0e1643963b38d87f26b0675Bb7dC96e;
    address constant ETH_USD_7day_FEED = 0xF3140662cE17fDee0A6675F9a511aDbc4f394003;

    // 1inch Protocol Constants
    uint256 private constant _MAKER_AMOUNT_FLAG = 1 << 255;
    uint256 private constant _HAS_EXTENSION_FLAG = 1 << 249;

    // EIP-712 Domain
    bytes32 constant DOMAIN_SEPARATOR = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("1inch Limit Order Protocol"),
            keccak256("4"),
            uint256(1), // mainnet
            address(LIMIT_ORDER_PROTOCOL)
        )
    );

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
        // Fork Mainnet
        vm.createSelectFork(vm.envString("ETH_RPC_URL"), MAINET_FORK_BLOCK);

        //set up accounts

        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);

        // deploy calculator
        calculator = new VolatilitySpreadCalculator(address(this));

        // set tokens

        deal(WETH, alice, 100 ether);
        deal(USDC, alice, 1_000_000 * 1e6);
        deal(DAI, alice, 1_000_000 * 1e6);
        deal(WETH, bob, 100 ether);
        deal(USDC, bob, 1_000_000 * 1e6);

        // Approve Tokens

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

        // setup volatility feeds
        address[] memory tokens = new address[](3);
        address[] memory vol24h = new address[](3);
        address[] memory vol7d = new address[](3);
        address[] memory priceFeeds = new address[](3);

        tokens[0] = WETH;
        vol24h[0] = ETH_USD_24hr_FEED;
        vol7d[0] = ETH_USD_7day_FEED;
        priceFeeds[0] = ETH_USD_FEED;

        tokens[1] = USDC;
        vol24h[1] = address(0);
        vol7d[1] = address(0);
        priceFeeds[1] = USDC_USD_FEED;

        tokens[2] = DAI;
        vol24h[2] = address(0);
        vol7d[2] = address(0);
        priceFeeds[2] = address(0);

        calculator.addTokenFeeds(tokens, vol24h, vol7d, priceFeeds);
    }

    function buildOrderWithVolatilitySpread(
        address maker,
        address makerAsset,
        address takerAsset,
        uint256 makingAmount,
        uint256 takingAmount,
        VolatilitySpreadCalculator.SpreadParams memory spreadParams
    ) internal view returns (ILimitOrderProtocol.Order memory order, bytes memory extension) {
        //Encode Spread parameters
        bytes memory spreadData = abi.encode(spreadParams);

        //Build the extension with voaltility calculator
        bytes memory makingAmountData = abi.encodePacked(address(calculator), spreadData);
        bytes memory takingAmountData = abi.encodePacked(address(calculator), spreadData);

        // calculate offset for extension
        uint256 offset1 = 0; // makingAmountData starts at 0
        uint256 offset2 = makingAmountData.length; // takingAmountData offset

        // Build extension: offsets + data
        extension = abi.encodePacked(
            uint64(offset1),
            uint64(offset2),
            uint64(offset2 + takingAmountData.length), // predicate offset (empty)
            uint64(offset2 + takingAmountData.length), // permit offset (empty)
            uint64(offset2 + takingAmountData.length), // preInteraction offset (empty)
            uint64(offset2 + takingAmountData.length), // postInteraction offset (empty)
            uint64(0), // unused
            uint64(0), // unused
            makingAmountData,
            takingAmountData
        );

        uint256 salt = uint256(keccak256(extension)) & ((1 << 160) - 1);

        order = ILimitOrderProtocol.Order({
            salt: salt,
            maker: maker,
            receiver: address(0),
            makerAsset: makerAsset,
            takerAsset: takerAsset,
            makingAmount: makingAmount,
            takingAmount: takingAmount,
            makerTraits: _HAS_EXTENSION_FLAG // Set extension flag
        });
    }

    function signOrder(ILimitOrderProtocol.Order memory order, uint256 privateKey)
        internal
        view
        returns (bytes32 r, bytes32 vs)
    {
        bytes32 orderHash = LIMIT_ORDER_PROTOCOL.hashOrder(order);

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, orderHash));

        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(privateKey, digest);
        vs = bytes32(uint256(v - 27) << 255) | s;
        r = r_;
    }
}
