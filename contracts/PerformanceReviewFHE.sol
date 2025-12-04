// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PerformanceReviewFHE is SepoliaConfig {
    struct EncryptedReview {
        uint256 reviewId;
        euint32 encryptedPerformanceScore;  // Encrypted performance rating
        euint32 encryptedReviewerGroup;    // Encrypted reviewer demographic group
        euint32 encryptedRevieweeGroup;    // Encrypted reviewee demographic group
        euint32 encryptedCalibrationScore; // Encrypted calibration adjustment
        uint256 timestamp;
    }
    
    struct EncryptedBiasModel {
        uint256 modelId;
        euint32 encryptedBiasThreshold;    // Encrypted bias detection threshold
        euint32 encryptedCalibrationRange; // Encrypted allowed calibration range
    }
    
    struct DecryptedAnalysis {
        uint32 biasScore;
        uint32 calibratedScore;
        bool isBiased;
        bool isCalibrated;
    }

    uint256 public reviewCount;
    uint256 public modelCount;
    mapping(uint256 => EncryptedReview) public performanceReviews;
    mapping(uint256 => EncryptedBiasModel) public biasModels;
    mapping(uint256 => DecryptedAnalysis) public reviewAnalyses;
    
    mapping(uint256 => euint32) private encryptedGroupStats;
    uint256[] private groupList;
    
    mapping(uint256 => uint256) private requestToReviewId;
    
    event ReviewSubmitted(uint256 indexed reviewId, uint256 timestamp);
    event AnalysisRequested(uint256 indexed reviewId);
    event BiasDetected(uint256 indexed reviewId, uint32 biasScore);
    event ReviewCalibrated(uint256 indexed reviewId);
    
    modifier onlyHR() {
        // Add HR authorization logic
        _;
    }
    
    modifier onlyManager() {
        // Add manager authorization logic
        _;
    }
    
    function submitPerformanceReview(
        euint32 encryptedPerformanceScore,
        euint32 encryptedReviewerGroup,
        euint32 encryptedRevieweeGroup
    ) public onlyManager {
        reviewCount += 1;
        uint256 newId = reviewCount;
        
        performanceReviews[newId] = EncryptedReview({
            reviewId: newId,
            encryptedPerformanceScore: encryptedPerformanceScore,
            encryptedReviewerGroup: encryptedReviewerGroup,
            encryptedRevieweeGroup: encryptedRevieweeGroup,
            encryptedCalibrationScore: FHE.asEuint32(0),
            timestamp: block.timestamp
        });
        
        reviewAnalyses[newId] = DecryptedAnalysis({
            biasScore: 0,
            calibratedScore: 0,
            isBiased: false,
            isCalibrated: false
        });
        
        emit ReviewSubmitted(newId, block.timestamp);
    }
    
    function addBiasModel(
        euint32 encryptedBiasThreshold,
        euint32 encryptedCalibrationRange
    ) public onlyHR {
        modelCount += 1;
        uint256 newId = modelCount;
        
        biasModels[newId] = EncryptedBiasModel({
            modelId: newId,
            encryptedBiasThreshold: encryptedBiasThreshold,
            encryptedCalibrationRange: encryptedCalibrationRange
        });
    }
    
    function requestBiasAnalysis(uint256 reviewId, uint256 modelId) public onlyHR {
        EncryptedReview storage review = performanceReviews[reviewId];
        EncryptedBiasModel storage model = biasModels[modelId];
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(review.encryptedPerformanceScore);
        ciphertexts[1] = FHE.toBytes32(review.encryptedReviewerGroup);
        ciphertexts[2] = FHE.toBytes32(review.encryptedRevieweeGroup);
        ciphertexts[3] = FHE.toBytes32(model.encryptedBiasThreshold);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeBias.selector);
        requestToReviewId[reqId] = reviewId;
        
        emit AnalysisRequested(reviewId);
    }
    
    function analyzeBias(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reviewId = requestToReviewId[requestId];
        require(reviewId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint32 performanceScore = results[0];
        uint32 reviewerGroup = results[1];
        uint32 revieweeGroup = results[2];
        uint32 biasThreshold = results[3];
        
        // Simplified bias detection
        uint32 biasScore = (reviewerGroup == revieweeGroup) ? 0 : 
            abs(performanceScore - calculateGroupAverage(reviewerGroup));
            
        bool isBiased = biasScore > biasThreshold;
        
        reviewAnalyses[reviewId].biasScore = biasScore;
        reviewAnalyses[reviewId].isBiased = isBiased;
        
        if (isBiased) {
            emit BiasDetected(reviewId, biasScore);
        }
    }
    
    function requestCalibration(uint256 reviewId, euint32 encryptedAdjustment) public onlyHR {
        EncryptedReview storage review = performanceReviews[reviewId];
        require(FHE.isInitialized(review.encryptedCalibrationScore) == false, "Already calibrated");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(review.encryptedPerformanceScore);
        ciphertexts[1] = FHE.toBytes32(encryptedAdjustment);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.applyCalibration.selector);
        requestToReviewId[reqId] = reviewId;
    }
    
    function applyCalibration(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reviewId = requestToReviewId[requestId];
        require(reviewId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint32 originalScore = results[0];
        uint32 adjustment = results[1];
        
        uint32 calibratedScore = originalScore + adjustment;
        performanceReviews[reviewId].encryptedCalibrationScore = FHE.asEuint32(calibratedScore);
        reviewAnalyses[reviewId].calibratedScore = calibratedScore;
        reviewAnalyses[reviewId].isCalibrated = true;
        
        emit ReviewCalibrated(reviewId);
    }
    
    function calculateGroupAverage(uint32 groupId) private view returns (uint32) {
        // Simplified group average calculation
        // In real implementation, use FHE operations on encryptedGroupStats
        return 75; // Placeholder value
    }
    
    function abs(uint32 x) private pure returns (uint32) {
        return x >= 0 ? x : -x;
    }
    
    function getReviewAnalysis(uint256 reviewId) public view returns (
        uint32 biasScore,
        uint32 calibratedScore,
        bool isBiased,
        bool isCalibrated
    ) {
        DecryptedAnalysis storage a = reviewAnalyses[reviewId];
        return (a.biasScore, a.calibratedScore, a.isBiased, a.isCalibrated);
    }
    
    function calculateDepartmentStats(euint32[] memory scores) public pure returns (euint32) {
        euint32 total = FHE.asEuint32(0);
        for (uint i = 0; i < scores.length; i++) {
            total = FHE.add(total, scores[i]);
        }
        return FHE.div(total, FHE.asEuint32(uint32(scores.length)));
    }
    
    function requestGroupStats(uint256 groupId) public onlyHR {
        euint32 stats = encryptedGroupStats[groupId];
        require(FHE.isInitialized(stats), "Group not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptGroupStats.selector);
        requestToReviewId[reqId] = groupId;
    }
    
    function decryptGroupStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 groupId = requestToReviewId[requestId];
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
        // Handle decrypted group statistics
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}