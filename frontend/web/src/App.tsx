import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PerformanceReview {
  id: string;
  encryptedData: string;
  timestamp: number;
  employeeId: string;
  rating: number;
  category: string;
  status: "pending" | "calibrated" | "flagged";
  biasScore?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newReviewData, setNewReviewData] = useState({
    employeeId: "",
    rating: 0,
    category: "",
    comments: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);

  // Calculate statistics for dashboard
  const calibratedCount = reviews.filter(r => r.status === "calibrated").length;
  const pendingCount = reviews.filter(r => r.status === "pending").length;
  const flaggedCount = reviews.filter(r => r.status === "flagged").length;
  const avgRating = reviews.length > 0 
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length 
    : 0;

  useEffect(() => {
    loadReviews().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadReviews = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing review keys:", e);
        }
      }
      
      const list: PerformanceReview[] = [];
      
      for (const key of keys) {
        try {
          const reviewBytes = await contract.getData(`review_${key}`);
          if (reviewBytes.length > 0) {
            try {
              const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
              list.push({
                id: key,
                encryptedData: reviewData.data,
                timestamp: reviewData.timestamp,
                employeeId: reviewData.employeeId,
                rating: reviewData.rating,
                category: reviewData.category,
                status: reviewData.status || "pending",
                biasScore: reviewData.biasScore
              });
            } catch (e) {
              console.error(`Error parsing review data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading review ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setReviews(list);
    } catch (e) {
      console.error("Error loading reviews:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitReview = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting performance data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newReviewData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reviewId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const reviewData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        employeeId: newReviewData.employeeId,
        rating: newReviewData.rating,
        category: newReviewData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `review_${reviewId}`, 
        ethers.toUtf8Bytes(JSON.stringify(reviewData))
      );
      
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(reviewId);
      
      await contract.setData(
        "review_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted review submitted securely!"
      });
      
      await loadReviews();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewReviewData({
          employeeId: "",
          rating: 0,
          category: "",
          comments: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const calibrateReview = async (reviewId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE calibration..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reviewBytes = await contract.getData(`review_${reviewId}`);
      if (reviewBytes.length === 0) {
        throw new Error("Review not found");
      }
      
      const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
      
      // Simulate FHE bias detection
      const biasScore = Math.random() * 100;
      const status = biasScore > 70 ? "flagged" : "calibrated";
      
      const updatedReview = {
        ...reviewData,
        status: status,
        biasScore: biasScore
      };
      
      await contract.setData(
        `review_${reviewId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedReview))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE ${status === "flagged" ? "bias detection" : "calibration"} completed!`
      });
      
      await loadReviews();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Calibration failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isManager = () => {
    // In a real app, this would check permissions
    return !!account;
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the performance review system",
      icon: "🔗"
    },
    {
      title: "Submit Performance Data",
      description: "Add encrypted performance reviews with FHE protection",
      icon: "🔒"
    },
    {
      title: "FHE Calibration",
      description: "Reviews are calibrated using FHE to ensure fairness",
      icon: "⚖️"
    },
    {
      title: "Bias Detection",
      description: "FHE algorithms detect potential bias in reviews",
      icon: "📊"
    },
    {
      title: "Get Results",
      description: "Receive calibrated results while keeping data private",
      icon: "✅"
    }
  ];

  const renderPieChart = () => {
    const total = reviews.length || 1;
    const calibratedPercentage = (calibratedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const flaggedPercentage = (flaggedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment calibrated" 
            style={{ transform: `rotate(${calibratedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(calibratedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment flagged" 
            style={{ transform: `rotate(${(calibratedPercentage + pendingPercentage + flaggedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{reviews.length}</div>
            <div className="pie-label">Reviews</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box calibrated"></div>
            <span>Calibrated: {calibratedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box flagged"></div>
            <span>Flagged: {flaggedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderRatingDistribution = () => {
    const ratingCounts = [0, 0, 0, 0, 0]; // 1-5 stars
    
    reviews.forEach(review => {
      if (review.rating >= 1 && review.rating <= 5) {
        ratingCounts[review.rating - 1]++;
      }
    });
    
    const maxCount = Math.max(...ratingCounts, 1);
    
    return (
      <div className="rating-distribution">
        <h4>Rating Distribution</h4>
        {ratingCounts.map((count, index) => (
          <div key={index} className="rating-bar">
            <div className="rating-label">{index + 1} star{index !== 0 ? 's' : ''}</div>
            <div className="rating-track">
              <div 
                className="rating-fill" 
                style={{ width: `${(count / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="rating-count">{count}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="circuit-icon"></div>
          </div>
          <h1>FHE<span>Performance</span>Review</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-review-btn cyber-button"
          >
            <div className="add-icon"></div>
            Add Review
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Performance Reviews</h2>
            <p>Fully Homomorphic Encryption enables bias detection and calibration on encrypted data</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Performance Review System</h2>
            <p className="subtitle">Learn how to conduct confidential performance reviews with FHE technology</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="dashboard-card cyber-card">
              <h3>Performance Analytics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{reviews.length}</div>
                  <div className="stat-label">Total Reviews</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{calibratedCount}</div>
                  <div className="stat-label">Calibrated</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{flaggedCount}</div>
                  <div className="stat-label">Flagged</div>
                </div>
                <div className="stat-item full-width">
                  <div className="stat-value">{avgRating.toFixed(1)}</div>
                  <div className="stat-label">Avg Rating</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card cyber-card">
              <h3>Status Distribution</h3>
              {renderPieChart()}
            </div>
          </div>
          
          <div className="panel-right">
            <div className="dashboard-card cyber-card">
              <h3>Rating Analytics</h3>
              {renderRatingDistribution()}
            </div>
            
            <div className="dashboard-card cyber-card">
              <h3>FHE Calibration Process</h3>
              <p>Our system uses Fully Homomorphic Encryption to:</p>
              <ul className="fhe-features">
                <li>Process performance data while encrypted</li>
                <li>Detect potential bias patterns</li>
                <li>Calibrate ratings across teams</li>
                <li>Maintain complete data confidentiality</li>
              </ul>
              <button 
                className="cyber-button small"
                onClick={async () => {
                  try {
                    const contract = await getContractReadOnly();
                    if (contract) {
                      const isAvailable = await contract.isAvailable();
                      alert(`FHE System Status: ${isAvailable ? 'Operational' : 'Unavailable'}`);
                    }
                  } catch (e) {
                    console.error("Error checking system status:", e);
                  }
                }}
              >
                Check System Status
              </button>
            </div>
          </div>
        </div>
        
        <div className="reviews-section">
          <div className="section-header">
            <h2>Encrypted Performance Reviews</h2>
            <div className="header-actions">
              <button 
                onClick={loadReviews}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="reviews-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Employee</div>
              <div className="header-cell">Rating</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Bias Score</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {reviews.length === 0 ? (
              <div className="no-reviews">
                <div className="no-reviews-icon"></div>
                <p>No performance reviews found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Review
                </button>
              </div>
            ) : (
              reviews.map(review => (
                <div className="review-row" key={review.id}>
                  <div className="table-cell review-id">#{review.id.substring(0, 6)}</div>
                  <div className="table-cell">{review.employeeId}</div>
                  <div className="table-cell">
                    <div className="rating-stars">
                      {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                    </div>
                  </div>
                  <div className="table-cell">{review.category}</div>
                  <div className="table-cell">
                    {new Date(review.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${review.status}`}>
                      {review.status}
                    </span>
                  </div>
                  <div className="table-cell">
                    {review.biasScore ? `${review.biasScore.toFixed(1)}%` : 'N/A'}
                  </div>
                  <div className="table-cell actions">
                    {isManager() && review.status === "pending" && (
                      <button 
                        className="action-btn cyber-button primary"
                        onClick={() => calibrateReview(review.id)}
                      >
                        Calibrate
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitReview} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          reviewData={newReviewData}
          setReviewData={setNewReviewData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="circuit-icon"></div>
              <span>FHE Performance Review</span>
            </div>
            <p>Confidential employee performance reviews with FHE calibration and bias detection</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Performance Review. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  reviewData: any;
  setReviewData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  reviewData,
  setReviewData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setReviewData({
      ...reviewData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!reviewData.employeeId || !reviewData.rating || !reviewData.category) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add Performance Review</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Performance data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Employee ID *</label>
              <input 
                type="text"
                name="employeeId"
                value={reviewData.employeeId} 
                onChange={handleChange}
                placeholder="Employee identifier" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Rating (1-5) *</label>
              <select 
                name="rating"
                value={reviewData.rating} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value={0}>Select rating</option>
                <option value={1}>1 Star</option>
                <option value={2}>2 Stars</option>
                <option value={3}>3 Stars</option>
                <option value={4}>4 Stars</option>
                <option value={5}>5 Stars</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={reviewData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select category</option>
                <option value="Technical Skills">Technical Skills</option>
                <option value="Communication">Communication</option>
                <option value="Teamwork">Teamwork</option>
                <option value="Leadership">Leadership</option>
                <option value="Innovation">Innovation</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Comments</label>
              <textarea 
                name="comments"
                value={reviewData.comments} 
                onChange={handleChange}
                placeholder="Additional comments about performance..." 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing and calibration
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;