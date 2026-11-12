'use strict';

// The provider JWT has both a short "ext" timestamp and a normal JWT "exp".
// API probes show the API continues accepting the token after "ext" passes,
// while "exp" is the actual JWT expiry used for safe refresh scheduling.
function parseJwtExpiry(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length !== 3 || !parts[1]) return 0;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const expiry = Number(payload.exp);
        return Number.isFinite(expiry) && expiry > 0 ? Math.floor(expiry) : 0;
    } catch {
        return 0;
    }
}

module.exports = { parseJwtExpiry };
