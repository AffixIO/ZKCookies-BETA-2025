import { CookieBanner } from './banner';

// Domain salt (should be unique per domain)
// In production, derive this from the domain name
const DOMAIN_SALT = BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(8)))
  .map(b => b.toString(16).padStart(2, '0'))
  .join(''));

// API endpoint (for demo, use local server)
// Start the server with: npm run dev:server
const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || 'http://localhost:100/verify';

// Initialize banner
const banner = new CookieBanner({
  apiEndpoint: API_ENDPOINT,
  domainSalt: DOMAIN_SALT,
  onAccept: () => {
    updateStatus('success', 'Consent proof verified! Banner will not appear again.');
  },
  onReject: () => {
    updateStatus('', 'Consent rejected. Banner will reappear on next visit.');
  },
});

// Update status display
function updateStatus(type: string, message: string) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = `status ${type}`;
    statusEl.innerHTML = `
      <strong>${type === 'success' ? '✓ Verified' : 'Status'}</strong>
      <p style="margin-top: 0.5rem; font-size: 0.9rem;">${message}</p>
    `;
  }
}

// Always show banner on page load (for demo purposes)
// In production, you'd check shouldShowBanner() first
console.log('Initializing cookie banner...');
console.log('Banner should show:', banner.shouldShowBanner());

// Show banner - force it to show for demo
banner.show();
updateStatus('', 'Cookie banner is visible. Click "Accept" to generate a zero-knowledge proof.');

// Add helper function to reset banner (for testing)
(window as any).resetBanner = async () => {
  // Reset client-side state
  localStorage.removeItem('zkcookies_banner_hidden');
  localStorage.removeItem('zkcookies_identity_secret');
  
  // Reset server-side state
  try {
    const response = await fetch('http://localhost:100/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      const result = await response.json();
      console.log('✓ Server reset:', result);
    } else {
      console.warn('Server reset failed, but continuing with client reset');
    }
  } catch (e) {
    console.warn('Could not reset server:', e);
  }
  
  location.reload();
};
console.log('💡 Tip: Run resetBanner() in console to reset and show banner again');

// Export for debugging
(window as any).zkcookies = {
  banner,
  DOMAIN_SALT: DOMAIN_SALT.toString(16),
};

