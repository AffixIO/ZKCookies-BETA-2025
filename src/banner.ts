import { ZKCookieBanner } from './zk';

export interface BannerConfig {
  apiEndpoint: string;
  domainSalt: bigint;
  onAccept?: () => void;
  onReject?: () => void;
}

export class CookieBanner {
  private zk: ZKCookieBanner;
  private config: BannerConfig;
  private bannerElement: HTMLElement | null = null;
  private readonly BANNER_HIDDEN_KEY = 'zkcookies_banner_hidden';

  constructor(config: BannerConfig) {
    this.zk = new ZKCookieBanner();
    this.config = config;
  }

  shouldShowBanner(): boolean {
    // Check if banner was already hidden via proof
    const hidden = localStorage.getItem(this.BANNER_HIDDEN_KEY);
    return hidden !== 'true';
  }

  async handleAccept(): Promise<void> {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const timestamp = currentTime;
      const domainSalt = this.config.domainSalt;

      // Generate proof for new consent
      // For first-time consent: oldConsent = 0, oldTimestamp = 0
      const proof = await this.zk.generateProof(
        domainSalt,
        0, // oldConsent
        255, // newConsent (all bits set = full consent)
        0, // oldTimestamp
        timestamp,
        currentTime
      );

      // Send proof to server (supports both ZK and offchain)
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proof: proof.proof,
          publicSignals: proof.publicSignals,
          offchain: proof.offchain,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Server response:', result);
        // Mark banner as hidden
        localStorage.setItem(this.BANNER_HIDDEN_KEY, 'true');
        this.hideBanner();
        if (this.config.onAccept) {
          this.config.onAccept();
        }
      } else {
        const errorText = await response.text();
        console.error('Server error response:', response.status, errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        throw new Error(`Server verification failed: ${errorData.error || response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to generate or verify proof:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Check if it's a nullifier already used error
      if (errorMsg.includes('Nullifier already used') || errorMsg.includes('double-spend')) {
        const reset = confirm(
          'You have already accepted consent. Would you like to reset and try again?\n\n' +
          'This will clear your local storage and server state.'
        );
        if (reset) {
          // Reset everything
          localStorage.removeItem('zkcookies_banner_hidden');
          localStorage.removeItem('zkcookies_identity_secret');
          
          // Reset server
          try {
            await fetch('http://localhost:100/reset', { method: 'POST' });
            console.log('✓ Server reset');
          } catch (e) {
            console.warn('Server reset failed:', e);
          }
          
          location.reload();
          return;
        }
      }
      
      alert(`Failed to process consent: ${errorMsg}. Please check the console for details.`);
    }
  }

  async handleReject(): Promise<void> {
    // For reject, we might still want to store a proof with consent = 0
    // For now, just hide the banner
    this.hideBanner();
    if (this.config.onReject) {
      this.config.onReject();
    }
  }

  private hideBanner(): void {
    if (this.bannerElement) {
      this.bannerElement.style.display = 'none';
    }
  }

  createBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.id = 'zkcookies-banner';
    banner.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #ffffff;
      padding: 1.5rem;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
      z-index: 99999;
      border-top: 3px solid #e94560;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      animation: slideUp 0.3s ease-out;
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from {
          transform: translateY(100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);

    const content = document.createElement('div');
    content.style.cssText = `
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2rem;
      flex-wrap: wrap;
    `;

    const text = document.createElement('div');
    text.style.cssText = `flex: 1; min-width: 300px;`;
    text.innerHTML = `
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1.2rem; color: #e94560;">
        🔒 Zero-Knowledge Cookie Consent
      </h3>
      <p style="margin: 0; font-size: 0.95rem; line-height: 1.5; color: #b8b8b8;">
        We use zero-knowledge proofs to verify your consent without storing your preferences.
        Your privacy is protected by cryptographic proofs.
      </p>
    `;

    const buttons = document.createElement('div');
    buttons.style.cssText = `
      display: flex;
      gap: 1rem;
      flex-shrink: 0;
    `;

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Reject';
    rejectBtn.style.cssText = `
      padding: 0.75rem 1.5rem;
      background: transparent;
      border: 1px solid #666;
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.95rem;
      transition: all 0.3s ease;
    `;
    rejectBtn.onmouseover = () => {
      rejectBtn.style.borderColor = '#999';
      rejectBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    };
    rejectBtn.onmouseout = () => {
      rejectBtn.style.borderColor = '#666';
      rejectBtn.style.background = 'transparent';
    };
    rejectBtn.onclick = () => this.handleReject();

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.style.cssText = `
      padding: 0.75rem 1.5rem;
      background: #e94560;
      border: none;
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 600;
      transition: all 0.3s ease;
    `;
    acceptBtn.onmouseover = () => {
      acceptBtn.style.background = '#d63447';
    };
    acceptBtn.onmouseout = () => {
      acceptBtn.style.background = '#e94560';
    };
    acceptBtn.onclick = () => this.handleAccept();

    buttons.appendChild(rejectBtn);
    buttons.appendChild(acceptBtn);
    content.appendChild(text);
    content.appendChild(buttons);
    banner.appendChild(content);

    this.bannerElement = banner;
    return banner;
  }

  show(): void {
    // Remove any existing banner first
    const existing = document.getElementById('zkcookies-banner');
    if (existing) {
      existing.remove();
    }

    // Always show banner (for demo - in production check shouldShowBanner())
    console.log('Showing cookie banner...');
    const banner = this.createBanner();
    document.body.appendChild(banner);
    console.log('✓ Banner displayed');

    // Auto-generate proof on repeat visits if identity exists
    // But don't auto-hide - let user click Accept
    if (this.zk.hasIdentitySecret() && false) { // Disabled auto-accept for demo
      // Automatically generate and send proof
      this.handleAccept().catch(err => {
        console.error('Auto-proof generation failed:', err);
        // If auto-proof fails, show banner anyway
      });
    }
  }
}

