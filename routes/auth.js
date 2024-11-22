// routes/auth.js

const express = require('express');
const router = express.Router();
const { execute } = require('../db'); // Ensure this is the updated db.js with proper execute function
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const transporter = require('../config/nodemailer'); // Nodemailer transporter
const logger = require('../utils/logger'); // Your logger utility
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Apply helmet middleware for security
router.use(helmet());

// Helper function for consistent error responses
const sendErrorResponse = (res, status, message, errors = null) => {
  const response = { message };
  if (errors) response.errors = errors;
  res.status(status).json(response);
};

// Rate Limiting for Auth Routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to sensitive routes
router.use('/login', authLimiter);
router.use('/register', authLimiter);
router.use('/forgot-password', authLimiter);
router.use('/reset-password', authLimiter);

/**
 * @route   POST /auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  [
    body('username').notEmpty().withMessage('Username is required').trim(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('Password must contain at least one number')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[!@#$%^&*(),.?":{}|<>]/)
      .withMessage('Password must contain at least one special character'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('full_name').notEmpty().withMessage('Full name is required').trim(),
    body('role')
      .isIn(['seller', 'buyer'])
      .withMessage('Role must be either seller or buyer'),
    body('company_name').notEmpty().withMessage('Company name is required').trim(),
    body('company_description')
      .notEmpty()
      .withMessage('Company description is required')
      .trim(),
    body('phone_number').notEmpty().withMessage('Phone number is required').trim(),
    body('address').notEmpty().withMessage('Address is required').trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Registration validation failed', { errors: errors.array() });
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const {
      username,
      password,
      email,
      full_name,
      role,
      company_name,
      company_description,
      phone_number,
      address,
    } = req.body;

    try {
      // Check if username already exists
      const checkUserSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
      logger.info('Executing SQL:', { sql: checkUserSql, binds: [username] });
      const existingUserResult = await execute({
        sqlText: checkUserSql,
        binds: [username],
      });

      if (existingUserResult && existingUserResult.length > 0) {
        logger.info(`Username already exists: ${username}`);
        return sendErrorResponse(res, 400, 'Username already exists');
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const USER_ID = uuidv4();

      // Insert the new user into Snowflake
      const insertUserSql = `
        INSERT INTO trade.gwtrade.USERS (
          USER_ID,
          USERNAME,
          PASSWORD_HASH,
          EMAIL,
          FULL_NAME,
          ROLE,
          COMPANY_NAME,
          COMPANY_DESCRIPTION,
          PHONE_NUMBER,
          ADDRESS
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      logger.info('Executing SQL:', { sql: insertUserSql, binds: [USER_ID, username, hashedPassword, email, full_name, role, company_name, company_description, phone_number, address] });
      await execute({
        sqlText: insertUserSql,
        binds: [
          USER_ID,
          username,
          hashedPassword,
          email,
          full_name,
          role,
          company_name,
          company_description,
          phone_number,
          address,
        ],
      });

      logger.info(`User registered successfully: ${username}`);

      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      logger.error('Registration error:', error);
      sendErrorResponse(res, 500, 'Server error', [{ msg: 'Internal server error' }]);
    }
  }
);

/**
 * @route   POST /auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 */
router.post(
  '/login',
  [
    body('username').notEmpty().withMessage('Username is required').trim(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Login validation failed', { errors: errors.array() });
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { username, password } = req.body;

    try {
      // Fetch user from Snowflake
      const loginSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
      logger.info('Executing SQL:', { sql: loginSql, binds: [username] });
      const userResult = await execute({
        sqlText: loginSql,
        binds: [username],
      });

      if (!userResult || userResult.length === 0) {
        logger.info(`Invalid credentials attempt for username: ${username}`);
        return sendErrorResponse(res, 400, 'Invalid credentials');
      }

      const user = userResult[0];
      const isMatch = await bcrypt.compare(password, user.PASSWORD_HASH);
      if (!isMatch) {
        logger.info(`Invalid credentials attempt for username: ${username}`);
        return sendErrorResponse(res, 400, 'Invalid credentials');
      }

      const payload = {
        user: {
          id: user.USER_ID,
          role: user.ROLE,
        },
      };

      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '1h' },
        (err, token) => {
          if (err) {
            logger.error('JWT Sign error:', err);
            throw err;
          }
          res.json({ token });
        }
      );
    } catch (error) {
      logger.error('Login error:', error);
      sendErrorResponse(res, 500, 'Server error', [{ msg: 'Internal server error' }]);
    }
  }
);

/**
 * @route   POST /auth/forgot-password
 * @desc    Initiate password reset by sending reset email
 * @access  Public
 */
router.post(
  '/forgot-password',
  [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email address')
      .normalizeEmail(),
  ],
  async (req, res) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Forgot password validation failed', { errors: errors.array() });
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { email } = req.body;

    try {
      // Check if user exists
      const checkUserSql = 'SELECT USER_ID, EMAIL FROM trade.gwtrade.USERS WHERE EMAIL = ?';
      logger.info('Executing SQL:', { sql: checkUserSql, binds: [email] });
      const userResult = await execute({
        sqlText: checkUserSql,
        binds: [email],
      });

      if (!userResult || userResult.length === 0) {
        // For security, don't reveal that email doesn't exist
        logger.info(`Password reset requested for non-existing email: ${email}`);
        return res.status(200).json({ message: 'Password reset email sent' });
      }

      const user = userResult[0];
      const userId = user.USER_ID;

      // Generate a reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      // Hash the token before storing
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = new Date(Date.now() + 24 * 3600000).toISOString(); // 24 hours from now in UTC

      // Update user record with hashed reset token and expiry
      const updateUserSql = `
        UPDATE trade.gwtrade.USERS
        SET RESET_PASSWORD_TOKEN = ?, RESET_PASSWORD_EXPIRES = ?
        WHERE USER_ID = ?
      `;
      logger.info('Executing SQL:', { sql: updateUserSql, binds: [resetTokenHash, resetTokenExpiry, userId] });
      await execute({
        sqlText: updateUserSql,
        binds: [resetTokenHash, resetTokenExpiry, userId],
      });

      // Create reset URL with raw token
      const resetUrl = `https://www.ke-eutrade.org/reset-password?token=${resetToken}&id=${userId}`;

      // Email content
      const mailOptions = {
        from: process.env.EMAIL_FROM || '"Support" <support@example.com>', // sender address
        to: user.EMAIL, // list of receivers
        subject: 'Password Reset Request',
        text: `You have requested to reset your password.

Please click the link below to reset your password:

${resetUrl}

If you did not request this, please ignore this email.`,
        html: `
          <p>You have requested to reset your password.</p>
          <p>Please click the link below to reset your password:</p>
          <a href="${resetUrl}">${resetUrl}</a>
          <p>If you did not request this, please ignore this email.</p>
        `,
      };

      // Send email
      await transporter.sendMail(mailOptions);

      logger.info(`Password reset email sent to ${user.EMAIL}`);

      res.status(200).json({ message: 'Password reset email sent' });
    } catch (error) {
      logger.error('Forgot password error:', error);
      sendErrorResponse(res, 500, 'Server error', [{ msg: 'Internal server error' }]);
    }
  }
);

/**
 * @route   POST /auth/reset-password
 * @desc    Reset user's password using token
 * @access  Public
 */
router.post(
  '/reset-password',
  [
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 64, max: 64 })
      .withMessage('Invalid token format'),
    body('id')
      .notEmpty()
      .withMessage('User ID is required')
      .isUUID()
      .withMessage('Invalid User ID format'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/\d/)
      .withMessage('Password must contain at least one number')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[!@#$%^&*(),.?":{}|<>]/)
      .withMessage('Password must contain at least one special character'),
  ],
  async (req, res) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Reset password validation failed', { errors: errors.array() });
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { token, id, password } = req.body;

    try {
      // Hash the received token to compare with stored hash
      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      logger.info('Password Reset Attempt:', {
        userId: id,
        // Do not log the hashed token to avoid exposing sensitive data
      });

      // Query to find the user with the matching reset token and unexpired
      const checkTokenSql = `
        SELECT USER_ID, EMAIL, RESET_PASSWORD_EXPIRES 
        FROM trade.gwtrade.USERS
        WHERE USER_ID = ? AND RESET_PASSWORD_TOKEN = ? AND RESET_PASSWORD_EXPIRES > CURRENT_TIMESTAMP()
      `;
      logger.info('Executing SQL Query for Token Validation:', { sql: checkTokenSql, binds: [id, resetTokenHash] });
      const userResult = await execute({
        sqlText: checkTokenSql,
        binds: [id, resetTokenHash],
      });

      if (!userResult || userResult.length === 0) {
        logger.info(`Invalid or expired password reset token for user ID: ${id}`);
        return sendErrorResponse(res, 400, 'Invalid or expired password reset token');
      }

      const user = userResult[0];
      const userId = user.USER_ID;

      // Log stored and current times for debugging
      logger.info('Token Validation Success:', {
        storedResetPasswordExpires: user.RESET_PASSWORD_EXPIRES,
        currentUtcTime: new Date().toISOString(),
      });

      // Hash the new password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Update user's password and clear reset token fields
      const updatePasswordSql = `
        UPDATE trade.gwtrade.USERS
        SET PASSWORD_HASH = ?, RESET_PASSWORD_TOKEN = NULL, RESET_PASSWORD_EXPIRES = NULL
        WHERE USER_ID = ?
      `;
      logger.info('Executing SQL Query to Update Password:', { sql: updatePasswordSql, binds: [hashedPassword, userId] });
      await execute({
        sqlText: updatePasswordSql,
        binds: [hashedPassword, userId],
      });

      // Send a confirmation email to the user
      const mailOptions = {
        from: process.env.EMAIL_FROM || '"Support" <support@example.com>',
        to: user.EMAIL,
        subject: 'Your password has been successfully reset',
        text: `Hello,

This is a confirmation that your password has been successfully reset.

If you did not perform this action, please contact our support immediately.

Best regards,
Support Team`,
        html: `
          <p>Hello,</p>
          <p>This is a confirmation that your password has been successfully reset.</p>
          <p>If you did not perform this action, please contact our support immediately.</p>
          <p>Best regards,<br/>Support Team</p>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Password reset successfully for user ${user.EMAIL}`);

      res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
      logger.error('Reset password error:', error);
      sendErrorResponse(res, 500, 'Server error', [{ msg: 'Internal server error' }]);
    }
  }
);

module.exports = router;
