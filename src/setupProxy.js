const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Add security headers middleware
  app.use((req, res, next) => {
    // Disable Cross-Origin-Opener-Policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    // Allow same-origin for Cross-Origin-Embedder-Policy
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
  
  // Add any proxies if needed
  // Example:
  // app.use(
  //   '/api',
  //   createProxyMiddleware({
  //     target: 'http://localhost:5000',
  //     changeOrigin: true,
  //   })
  // );
};