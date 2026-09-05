process.env.PORT ||= '3000';
process.env.SESSION_SECRET ||= 'social-manager-demo-session-secret';
process.env.TOKEN_ENCRYPTION_KEY ||= 'social-manager-demo-token-encryption-key';
process.env.ADMIN_USER ||= 'admin';
process.env.ADMIN_PASSWORD ||= 'admin123';
process.env.PUBLIC_BASE_URL ||= `http://localhost:${process.env.PORT}`;
process.env.COOKIE_SECURE ||= 'false';
process.env.DEMO_MODE = 'true';

// Fake credentials only unlock the local workflow. The platform adapters never
// call Meta while DEMO_MODE=true.
process.env.FACEBOOK_PAGE_ID ||= 'demo-facebook-page';
process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||= 'demo-facebook-token';
process.env.INSTAGRAM_USER_ID ||= 'demo-instagram-user';
process.env.INSTAGRAM_ACCESS_TOKEN ||= 'demo-instagram-token';

console.log('Social Manager DEMO MODE');
console.log(`URL: ${process.env.PUBLIC_BASE_URL}`);
console.log(`Login: ${process.env.ADMIN_USER} / ${process.env.ADMIN_PASSWORD}`);
console.log('Facebook/Instagram publishing is simulated; no real social post is sent.');

await import('../src/server.js');
