// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPointMathLib} from "@solady/utils/FixedPointMathLib.sol";
import {IAmountGetter} from "./interfaces/IAmountGetter.sol";

contract VolatilitySpreadCalculator is IAmountGetter {
    function getTakingAmount(
        Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external view returns (uint256) {}

    function getMakingAmount(
        Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external view returns (uint256) {}
}
