import React from 'react';
import './HomePage.css';

interface HomePageProps {
  onNavigate: (page: string) => void;
}

const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  return (
    <div className="home-container">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-content">
          <h1>Unlock the Value of <span className="highlight">Your Digital DNA</span></h1>
          <p className="hero-subtitle">
            Own, control, and monetize your personal data in a secure vault that only you can access.
          </p>
          <div className="hero-buttons">
            <button className="btn primary-btn" onClick={() => onNavigate('upload')}>
              Get Started
            </button>
            <button className="btn secondary-btn" onClick={() => window.location.href = '#learn-more'}>
              Learn More
            </button>
          </div>
        </div>
        <div className="hero-image">
          <img src="/images/digital-dna-concept.svg" alt="Digital DNA Visualization" />
        </div>
      </section>

      {/* How It Works Section */}
      <section className="how-it-works-section" id="learn-more">
        <h2>How Digital DNA Works</h2>
        <div className="steps-container">
          <div className="step-card">
            <div className="step-number">1</div>
            <h3>Download Your Data</h3>
            <p>Request and download your personal data from major tech companies under CCPA rights.</p>
            <img src="/images/download-icon.svg" alt="Download Data" className="step-icon" />
          </div>
          <div className="step-card">
            <div className="step-number">2</div>
            <h3>Upload to Your Vault</h3>
            <p>Securely upload your data to your personal vault with end-to-end encryption.</p>
            <img src="/images/upload-icon.svg" alt="Upload to Vault" className="step-icon" />
          </div>
          <div className="step-card">
            <div className="step-number">3</div>
            <h3>Create Personas</h3>
            <p>We use AI to analyze your data and create valuable personas based on your digital history.</p>
            <img src="/images/persona-icon.svg" alt="Create Personas" className="step-icon" />
          </div>
          <div className="step-card">
            <div className="step-number">4</div>
            <h3>Share & Monetize</h3>
            <p>Generate secure links to share selected personas with marketers and earn from your data.</p>
            <img src="/images/monetize-icon.svg" alt="Share and Monetize" className="step-icon" />
          </div>
        </div>
      </section>

      {/* Persona Types Section */}
      <section className="personas-section">
        <h2>Your Digital Personas</h2>
        <p className="section-subtitle">Our AI analyzes your data to create comprehensive profiles that showcase different aspects of your digital life</p>
        
        <div className="personas-grid">
          <div className="persona-card financial">
            <div className="persona-icon">💰</div>
            <h3>Financial Persona</h3>
            <p>Analyze spending patterns, financial interests, and purchasing power from transaction data</p>
          </div>
          <div className="persona-card social">
            <div className="persona-icon">👥</div>
            <h3>Social Persona</h3>
            <p>Understand social connections, interests, and engagement patterns from social media data</p>
          </div>
          <div className="persona-card entertainment">
            <div className="persona-icon">🎬</div>
            <h3>Entertainment Persona</h3>
            <p>Discover content preferences, viewing habits, and entertainment interests</p>
          </div>
          <div className="persona-card career">
            <div className="persona-icon">💼</div>
            <h3>Career Persona</h3>
            <p>Showcase professional skills, work history, and career trajectory</p>
          </div>
        </div>
      </section>

      {/* Data Sources Section */}
      <section className="data-sources-section">
        <h2>Supported Data Sources</h2>
        <p className="section-subtitle">We provide easy-to-follow guides for downloading your data from major platforms</p>
        
        <div className="sources-grid">
          <div className="source-card">
            <img src="/images/facebook-logo.svg" alt="Facebook" className="source-logo" />
            <h3>Facebook</h3>
            <button className="btn guide-btn" onClick={() => onNavigate('guides/facebook')}>Download Guide</button>
          </div>
          <div className="source-card">
            <img src="/images/google-logo.svg" alt="Google" className="source-logo" />
            <h3>Google</h3>
            <button className="btn guide-btn" onClick={() => onNavigate('guides/google')}>Download Guide</button>
          </div>
          <div className="source-card">
            <img src="/images/linkedin-logo.svg" alt="LinkedIn" className="source-logo" />
            <h3>LinkedIn</h3>
            <button className="btn guide-btn" onClick={() => onNavigate('guides/linkedin')}>Download Guide</button>
          </div>
          <div className="source-card">
            <img src="/images/twitter-logo.svg" alt="Twitter" className="source-logo" />
            <h3>Twitter</h3>
            <button className="btn guide-btn" onClick={() => onNavigate('guides/twitter')}>Download Guide</button>
          </div>
        </div>
      </section>

      {/* Value Proposition Section */}
      <section className="value-section">
        <h2>The Future of Personal Data</h2>
        <div className="value-container">
          <div className="value-content">
            <h3>Your Data, Your Value</h3>
            <p>Companies have been profiting from your data for years. Now it's time for you to take control and benefit from the value you create online.</p>
            
            <div className="value-points">
              <div className="value-point">
                <div className="point-icon">🔒</div>
                <div className="point-text">
                  <strong>Security First</strong>
                  <p>End-to-end encryption ensures only you can access your complete data vault</p>
                </div>
              </div>
              <div className="value-point">
                <div className="point-icon">💼</div>
                <div className="point-text">
                  <strong>Data Marketplace</strong>
                  <p>Coming soon: A marketplace where your personas have value and marketers can bid for access</p>
                </div>
              </div>
              <div className="value-point">
                <div className="point-icon">📊</div>
                <div className="point-text">
                  <strong>Transparent Analytics</strong>
                  <p>See exactly how your data is being used and the value it creates</p>
                </div>
              </div>
            </div>
          </div>
          <div className="value-image">
            <img src="/images/data-marketplace.svg" alt="Data Marketplace Visualization" />
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="cta-section">
        <h2>Ready to Unlock Your Digital DNA?</h2>
        <p>Take the first step toward owning and monetizing your personal data</p>
        <button className="btn primary-btn large" onClick={() => onNavigate('upload')}>
          Create Your Data Vault
        </button>
      </section>
    </div>
  );
};

export default HomePage;