// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPointMathLib} from "@solady/utils/FixedPointMathLib.sol";
import {IAmountGetter,IOrderMixin} from "./interfaces/IAmountGetter.sol";

contract VolatilitySpreadCalculator is IAmountGetter {
    using FixedPointMathLib for uint256;

    // constants 
    uint256 private constant BASIS_POINTS = 10000; 
    uint256 private constant MAX_SPREAD = 1000;

    // ============ EVENTS ============
    
    event SpreadCalculated(
        bytes32 indexed orderHash,
        address indexed token,
        uint256 volatility,
        uint256 dynamicSpread,
        uint256 adjustedAmount
    );

    // Struct
    struct SpreadParams{
        uint256 baseSpreadBps;          // Base spread (e.g., 50 = 0.5%)
        uint256 volatilityMultiplier;  // How volatility affects spread (e.g., 200 = 2x)
        uint256 maxSpreadBps;        // Maximum spread (e.g., 200 = 2%)
        uint8 volatilityWindow;      // 0=24h, 1=7d, 2=blended
        bool useTargetToken;         // true=use makerAsset, false=use takerAsset for volatility
    }

      // ============ MAIN FUNCTIONS ============
    /**
     * @notice Calculate taking amount with dynamic spread
     * @dev Token info comes from order.makerAsset and order.takerAsset!
     */
   function getTakingAmount(
        IOrderMixin.Order calldata order,
        bytes calldata /* extension */,
        bytes32 /* orderHash */,
        address /* taker */,
        uint256 makingAmount,
        uint256 /* remainingMakingAmount */,
        bytes calldata extraData
    ) external view returns (uint256 takingAmount){
        SpreadParams memory params = _decodeExtraData(extraData);

        // determine which token to use for volatility
        address targetToken = params.useTargetToken ? order.makerAsset: order.takerAsset;

        // Get Valatility for the target token
        uint256 currentVolatility  = _getTokenVolatility(targetToken,params.volatilityWindow);

        // calculate Dynamic Spread
        uint256 dynamicSpread = _calculateDynamicSpread(params.baseSpreadBps,
        params.volatilityMultiplier,
        params.maxSpreadBps,
        currentVolatility);

        // Apply spread to taking Amount
        uint256 originalTakingAmount = (order.takingAmount * makingAmount) / order.makingAmount;
        takingAmount  = originalTakingAmount + (originalTakingAmount * dynamicSpread)/BASIS_POINTS;

        // emit SpreadCalculated(orderHash,targetToken,currentVolatility,dynamicSpread,takingAmount);
    }

    /**
     * @notice Calculate making amount with dynamic spread
    */

     function getMakingAmount(
        IOrderMixin.Order calldata order,
        bytes calldata /* extension */,
        bytes32 /* orderHash */,
        address /* taker */,
        uint256 takingAmount,
        uint256 /* remainingMakingAmount */,
        bytes calldata extraData
    ) external view returns (uint256 makingAmount){
        SpreadParams memory params = _decodeExtraData(extraData);

        // Determine ehich Token to use for volatality calculation
        address targetToken =  params.useTargetToken ? order.makerAsset : order.takerAsset;
        
        // Get volatility for the target token
        uint256 currentVolatility = _getTokenVolatility(targetToken, params.volatilityWindow);

          // Calculate dynamic spread
        uint256 dynamicSpread = _calculateDynamicSpread(
            params.baseSpreadBps,
            params.volatilityMultiplier,
            params.maxSpreadBps,
            currentVolatility
        );

          // Apply spread to making amount
        uint256 originalMakingAmount = (order.makingAmount * takingAmount) / order.takingAmount;
        makingAmount = originalMakingAmount - (originalMakingAmount * dynamicSpread / BASIS_POINTS);
        
        // emit SpreadCalculated(orderHash, targetToken, currentVolatility, dynamicSpread, makingAmount);

    }
    /**
     * @dev Calculate dynamic spread based on volatility
     */
    function _calculateDynamicSpread(
        uint256 baseSpreadBps,
        uint256 volatilityMultiplier,
        uint256 maxSpreadBps,
        uint256 currentVolatility
    ) internal pure returns (uint256) {
        // Convert volatility from basis points to percentage
        uint256 volatilityPct = currentVolatility / 100;

        // Calculate volatility impact
        uint256 volatilityImpact = (volatilityPct * volatilityMultiplier) / 100;
        // Add to base spread
        uint256 dynamicSpread = baseSpreadBps + volatilityImpact;

        // Cap at maximum spread
        return FixedPointMathLib.min(dynamicSpread, maxSpreadBps);

    }

    function _decodeExtraData(bytes calldata extraData) internal pure returns(SpreadParams memory){
        return abi.decode(extraData,(SpreadParams));

    }

        /**
     * @notice Preview spread for a token pair
     */
    function previewSpread(
        address tokenA,        // From order.makerAsset or order.takerAsset
        uint256 baseSpreadBps,
        uint256 volatilityMultiplier,
        uint256 maxSpreadBps,
        uint8 volatilityWindow
    ) external view returns (uint256 currentVolatility, uint256 dynamicSpread) {
        currentVolatility = _getTokenVolatility(tokenA, volatilityWindow);
        dynamicSpread = _calculateDynamicSpread(baseSpreadBps, volatilityMultiplier, maxSpreadBps, currentVolatility);
    }

    /**
     * @notice Encode spread parameters for order creation
     */
    function encodeSpreadParams(
        uint256 baseSpreadBps,
        uint256 _volatilityMultiplier,
        uint256 maxSpreadBps,
        uint8 volatilityWindow,
        bool useTargetToken
    ) external pure returns (bytes memory) {
        require(baseSpreadBps <= MAX_SPREAD, "Base spread too high");
        require(maxSpreadBps <= MAX_SPREAD, "Max spread too high");
        require(_volatilityMultiplier <= 1000, "Multiplier too high");
        require(volatilityWindow <= 2, "Invalid volatility window");
        
        return abi.encode(SpreadParams({
            baseSpreadBps: baseSpreadBps,
            volatilityMultiplier: _volatilityMultiplier,
            maxSpreadBps: maxSpreadBps,
            volatilityWindow: volatilityWindow,
            useTargetToken: useTargetToken
        }));
    }

   function _getTokenVolatility(address token, uint8 window) internal view returns (uint256) {

   }
}
