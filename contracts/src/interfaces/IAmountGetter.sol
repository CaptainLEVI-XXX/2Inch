    // SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Address} from "../libraries/AddressLib.sol";
import {MakerTraits} from "../libraries/MakerTraitLib.sol";

interface IAmountGetter {
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

    function getTakingAmount(
        Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external view returns (uint256);

    function getMakingAmount(
        Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external view returns (uint256);
}
