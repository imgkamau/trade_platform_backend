// routes/auth.js

const express = require('express');
const router = express.Router();
const db = require('../db'); // Snowflake connection
const { body, validationResult, query } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const logger = require('../utils/logger'); // Your logger utility
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer'); // Nodemailer module

// Apply helmet middleware for security
router.use(helmet());

// Nodemailer transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail', // Use your email service provider
  auth: {
    user: process.env.EMAIL_USER, // Your email address
    pass: process.env.EMAIL_PASS, // Your email password or app-specific password
  },
});

// Helper function for consistent error responses
const sendErrorResponse = (res, status, message, errors = null) => {
  const response = { message };
  if (errors) response.errors = errors;
  res.status(status).json(response);
};

// Rate Limiting for Auth Routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to sensitive routes
router.use('/login', authLimiter);
router.use('/register', authLimiter);
router.use('/forgot-password', authLimiter);
router.use('/reset-password', authLimiter);
router.use('/verify-email', authLimiter);

/**
 * @route   POST /auth/register
 * @desc    Register a new user and send verification email
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
      // Check for username and email uniqueness
      let validationErrors = [];

      // Check username
      const checkUsernameSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
      logger.info('Executing SQL:', checkUsernameSql);
      const usernameStatement = await db.execute({
        sqlText: checkUsernameSql,
        binds: [username],
      });
      const existingUsernameResult = await usernameStatement.fetchAll();
      if (existingUsernameResult && existingUsernameResult.length > 0) {
        validationErrors.push({ msg: 'Username already exists', param: 'username', location: 'body' });
      }

      // Check email
      const checkEmailSql = 'SELECT * FROM trade.gwtrade.USERS WHERE EMAIL = ?';
      logger.info('Executing SQL:', checkEmailSql);
      const emailStatement = await db.execute({
        sqlText: checkEmailSql,
        binds: [email],
      });
      const existingEmailResult = await emailStatement.fetchAll();
      if (existingEmailResult && existingEmailResult.length > 0) {
        validationErrors.push({ msg: 'Email already exists', param: 'email', location: 'body' });
      }

      if (validationErrors.length > 0) {
        return sendErrorResponse(res, 400, 'Validation failed', validationErrors);
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const USER_ID = uuidv4();

      // Generate email verification token
      const verificationToken = uuidv4();
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours from now

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
          ADDRESS,
          IS_EMAIL_VERIFIED,
          EMAIL_VERIFICATION_TOKEN,
          EMAIL_VERIFICATION_EXPIRES
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      logger.info('Executing SQL:', insertUserSql);
      const insertStatement = await db.execute({
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
          false, // IS_EMAIL_VERIFIED
          verificationToken,
          tokenExpires,
        ],
      });
      await insertStatement.fetchAll(); // Ensure the insert is completed

      // Send verification email
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}`;

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify Your Email for Kenya-EU Trade Platform',
        html: `
          <h1>Welcome to Kenya-EU Trade Platform</h1>
          <p>Please click the link below to verify your email address:</p>
          <a href="${verificationLink}">${verificationLink}</a>
          <p>This link will expire in 24 hours.</p>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Verification email sent to ${email}`);

      res.status(201).json({ message: 'User registered successfully. Please verify your email.' });
    } catch (error) {
      logger.error('Registration error:', error);
      const errorDetails = [{ msg: error.message }];
      if (process.env.NODE_ENV === 'development') {
        errorDetails.push({ stack: error.stack });
      }
      sendErrorResponse(res, 500, 'Server error', errorDetails);
    }
  }
);

/**
 * @route   GET /auth/verify-email
 * @desc    Verify user's email using token from query parameter
 * @access  Public
 */
router.get(
  '/verify-email',
  [
    query('token').notEmpty().withMessage('Verification token is required').trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { token } = req.query;

    try {
      // Fetch user with the given token
      const verifyEmailSql = `
        SELECT USER_ID, EMAIL_VERIFICATION_EXPIRES, IS_EMAIL_VERIFIED
        FROM trade.gwtrade.USERS
        WHERE EMAIL_VERIFICATION_TOKEN = ?
      `;
      logger.info('Executing SQL:', verifyEmailSql);

      const statement = await db.execute({
        sqlText: verifyEmailSql,
        binds: [token],
      });

      const rows = await statement.fetchAll();
      if (!rows || rows.length === 0) {
        return sendErrorResponse(res, 400, 'Invalid verification token');
      }

      const user = rows[0];

      if (user.IS_EMAIL_VERIFIED) {
        return sendErrorResponse(res, 400, 'Email is already verified');
      }

      const now = new Date();
      if (now > new Date(user.EMAIL_VERIFICATION_EXPIRES)) {
        return sendErrorResponse(res, 400, 'Verification token has expired');
      }

      // Update user's email verification status
      const updateUserSql = `
        UPDATE trade.gwtrade.USERS
        SET IS_EMAIL_VERIFIED = TRUE, EMAIL_VERIFICATION_TOKEN = NULL, EMAIL_VERIFICATION_EXPIRES = NULL
        WHERE USER_ID = ?
      `;
      logger.info('Executing SQL:', updateUserSql);

      const updateStatement = await db.execute({
        sqlText: updateUserSql,
        binds: [user.USER_ID],
      });

      await updateStatement.fetchAll(); // Ensure the update is completed

      // Redirect the user to a confirmation page on the frontend
      const redirectUrl = `${process.env.FRONTEND_URL}/email-verified`;
      res.redirect(redirectUrl);
    } catch (error) {
      logger.error('Email verification error:', error);
      const errorDetails = [{ msg: error.message }];
      if (process.env.NODE_ENV === 'development') {
        errorDetails.push({ stack: error.stack });
      }
      sendErrorResponse(res, 500, 'Server error', errorDetails);
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
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { username, password } = req.body;

    try {
      // Fetch user from Snowflake
      const loginSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
      logger.info('Executing SQL:', loginSql);
      const statement = await db.execute({
        sqlText: loginSql,
        binds: [username],
      });
      const userResult = await statement.fetchAll();

      if (!userResult || userResult.length === 0) {
        return sendErrorResponse(res, 400, 'Invalid credentials');
      }

      const user = userResult[0];

      // Check if email is verified
      if (!user.IS_EMAIL_VERIFIED) {
        return sendErrorResponse(res, 400, 'Email is not verified');
      }

      const isMatch = await bcrypt.compare(password, user.PASSWORD_HASH);
      if (!isMatch) {
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
      const errorDetails = [{ msg: error.message }];
      if (process.env.NODE_ENV === 'development') {
        errorDetails.push({ stack: error.stack });
      }
      sendErrorResponse(res, 500, 'Server error', errorDetails);
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
      logger.info('Executing SQL:', checkUserSql);
      const statement = await db.execute({
        sqlText: checkUserSql,
        binds: [email],
      });
      const userResult = await statement.fetchAll();

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

      // Update user record with reset token and expiry
      const updateUserSql = `
        UPDATE trade.gwtrade.USERS
        SET RESET_PASSWORD_TOKEN = ?, RESET_PASSWORD_EXPIRES = ?
        WHERE USER_ID = ?
      `;
      logger.info('Executing SQL:', updateUserSql);
      const updateStatement = await db.execute({
        sqlText: updateUserSql,
        binds: [resetTokenHash, resetTokenExpiry, userId],
      });
      await updateStatement.fetchAll(); // Ensure the update is completed

      // Create reset URL
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&id=${userId}`;

      // Email content
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.EMAIL,
        subject: 'Password Reset Request',
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
      const errorDetails = [{ msg: error.message }];
      if (process.env.NODE_ENV === 'development') {
        errorDetails.push({ stack: error.stack });
      }
      sendErrorResponse(res, 500, 'Server error', errorDetails);
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
        resetTokenHash: resetTokenHash,
      });

      // Query to find the user with the matching reset token and unexpired
      const checkTokenSql = `
        SELECT USER_ID, EMAIL, RESET_PASSWORD_EXPIRES 
        FROM trade.gwtrade.USERS
        WHERE USER_ID = ? AND RESET_PASSWORD_TOKEN = ? AND RESET_PASSWORD_EXPIRES > CURRENT_TIMESTAMP()
      `;
      logger.info('Executing SQL Query for Token Validation:', {
        sql: checkTokenSql,
        binds: [id, resetTokenHash],
      });
      const statement = await db.execute({
        sqlText: checkTokenSql,
        binds: [id, resetTokenHash],
      });
      const userResult = await statement.fetchAll();

      if (!userResult || userResult.length === 0) {
        logger.info(`Invalid or expired password reset token for user ID: ${id}`);
        return sendErrorResponse(res, 400, 'Invalid or expired password reset token');
      }

      const user = userResult[0];
      const userId = user.USER_ID;

      // Hash the new password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Update user's password and clear reset token fields
      const updatePasswordSql = `
        UPDATE trade.gwtrade.USERS
        SET PASSWORD_HASH = ?, RESET_PASSWORD_TOKEN = NULL, RESET_PASSWORD_EXPIRES = NULL
        WHERE USER_ID = ?
      `;
      logger.info('Executing SQL Query to Update Password:', {
        sql: updatePasswordSql,
        binds: [hashedPassword, userId],
      });
      const updateStatement = await db.execute({
        sqlText: updatePasswordSql,
        binds: [hashedPassword, userId],
      });
      await updateStatement.fetchAll(); // Ensure the update is completed

      // Send a confirmation email to the user
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.EMAIL,
        subject: 'Your password has been successfully reset',
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
      const errorDetails = [{ msg: error.message }];
      if (process.env.NODE_ENV === 'development') {
        errorDetails.push({ stack: error.stack });
      }
      sendErrorResponse(res, 500, 'Server error', errorDetails);
    }
  }
);

module.exports = router;
