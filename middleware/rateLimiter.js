// middleware/rateLimiter.js

const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 upload requests per windowMs
    message: 'Too many upload attempts from this IP, please try again after 15 minutes.'
});

module.exports = uploadLimiter;
