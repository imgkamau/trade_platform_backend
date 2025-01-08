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
const cors = require('cors'); // CORS middleware
const sendEmail = require('../config/nodemailer');

// Apply helmet middleware for security
router.use(helmet());

// Apply CORS middleware
router.use(cors({
  origin: 'https://www.ke-eutrade.org', // Replace with your frontend URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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
    try {
      // Test database access explicitly
      console.log('Testing database access...');
      const testQuery = await db.execute({
        sqlText: 'SELECT CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA()',
      });
      console.log('Database access test:', testQuery);

      // Test table access
      console.log('Testing table access...');
      const tableTest = await db.execute({
        sqlText: 'SELECT COUNT(*) FROM trade.gwtrade.USERS',
      });
      console.log('Table access test:', tableTest);

      // 1. Debug Point: Initial Connection Test
      try {
        console.log('Testing Snowflake connection...');
        await db.execute({
          sqlText: 'SELECT CURRENT_TIMESTAMP()',
        });
        console.log('Snowflake connection successful');
      } catch (error) {
        console.error('Snowflake connection error:', {
          message: error.message,
          code: error.code,
          state: error.state
        });
        return sendErrorResponse(res, 500, 'Database connection error');
      }

      // 2. Debug Point: Environment Variables
      console.log('Checking environment variables:', {
        hasAccount: !!process.env.SNOWFLAKE_ACCOUNT,
        hasUser: !!process.env.SNOWFLAKE_USER,
        hasPassword: !!process.env.SNOWFLAKE_PASSWORD,
        hasDatabase: !!process.env.SNOWFLAKE_DATABASE,
        hasSchema: !!process.env.SNOWFLAKE_SCHEMA,
        hasWarehouse: !!process.env.SNOWFLAKE_WAREHOUSE,
      });

      // 3. Debug Point: Request Validation
      console.log('Request body:', {
        ...req.body,
        password: '[REDACTED]'
      });

      console.log('=== Registration Request Received ===');
      console.log('Request Body:', {
        ...req.body,
        password: '[REDACTED]' // Don't log passwords
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('Validation Errors:', errors.array());
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
        console.log('Checking for existing username...');
        const checkUsernameSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
        console.log('SQL:', checkUsernameSql);
        const existingUsernameResult = await db.execute({
          sqlText: checkUsernameSql,
          binds: [username],
        });
        console.log('Username check result:', existingUsernameResult);

        // Check for username and email uniqueness
        let validationErrors = [];

        // Check username
        const checkEmailSql = 'SELECT * FROM trade.gwtrade.USERS WHERE EMAIL = ?';
        logger.info('Executing SQL:', checkEmailSql);
        const existingEmailResult = await db.execute({
          sqlText: checkEmailSql,
          binds: [email],
        });

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
        await db.execute({
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

        // Send verification email
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}`;

        try {
          await sendEmail({
            to: email,
            subject: 'Verify Your Email for Kenya-EU Trade Platform',
            html: `
              <h1>Welcome to Kenya-EU Trade Platform</h1>
              <p>Please click the link below to verify your email address:</p>
              <a href="${verificationLink}">${verificationLink}</a>
              <p>This link will expire in 24 hours.</p>
            `
          });
          
          console.log('=== Registration Successful ===');
          res.status(201).json({ message: 'User registered successfully. Please verify your email.' });
        } catch (error) {
          console.error('=== Email Sending Error ===');
          console.error('Error details:', error);
          throw error;
        }
      } catch (error) {
        // 6. Enhanced Error Logging
        console.error('Registration error:', {
          message: error.message,
          code: error.code,
          state: error.sqlState,
          stack: error.stack,
          query: error.query,
          parameters: error.parameters
        });
        return sendErrorResponse(res, 500, 'Registration failed: ' + error.message);
      }
    } catch (error) {
      console.error('Registration error details:', {
        message: error.message,
        code: error.code,
        state: error.sqlState,
        query: error?.sqlText,
        binds: error?.binds,
        stack: error.stack
      });
      return res.status(500).json({
        error: 'Registration failed',
        details: error.message,
        code: error.code
      });
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
      const userResult = await db.execute({
        sqlText: verifyEmailSql,
        binds: [token],
      });

      if (!userResult || userResult.length === 0) {
        return sendErrorResponse(res, 400, 'Invalid verification token');
      }

      const user = userResult[0];

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
      await db.execute({
        sqlText: updateUserSql,
        binds: [user.USER_ID],
      });

      // Respond with success message
      res.json({ message: 'Email verified successfully' });
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
      const userResult = await db.execute({
        sqlText: loginSql,
        binds: [username],
      });

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

          // Exclude sensitive information before sending the user object
          const userResponse = {
            id: user.USER_ID,
            username: user.USERNAME,
            email: user.EMAIL,
            full_name: user.FULL_NAME,
            role: user.ROLE,
            isEmailVerified: user.IS_EMAIL_VERIFIED,
            // Include other necessary fields, but exclude sensitive ones like PASSWORD_HASH
          };

          res.json({ token, user: userResponse });
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
  [body('email').isEmail().withMessage('Please provide a valid email address').normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { email } = req.body;

    try {
      const checkUserSql = 'SELECT USER_ID, EMAIL FROM trade.gwtrade.USERS WHERE EMAIL = ?';
      const userResult = await db.execute({
        sqlText: checkUserSql,
        binds: [email],
      });

      // Always return success for security (even if email doesn't exist)
      if (!userResult || userResult.length === 0) {
        return res.status(200).json({ message: 'Password reset email sent' });
      }

      const user = userResult[0];
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = new Date(Date.now() + 24 * 3600000).toISOString();

      await db.execute({
        sqlText: `
          UPDATE trade.gwtrade.USERS
          SET RESET_PASSWORD_TOKEN = ?, RESET_PASSWORD_EXPIRES = ?
          WHERE USER_ID = ?
        `,
        binds: [resetTokenHash, resetTokenExpiry, user.USER_ID],
      });

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&id=${user.USER_ID}`;
      
      await sendEmail({
        to: user.EMAIL,
        subject: 'Password Reset Request',
        html: `
          <h1>Password Reset Request</h1>
          <p>You have requested to reset your password.</p>
          <p>Please click the link below to reset your password:</p>
          <a href="${resetUrl}">${resetUrl}</a>
          <p>This link will expire in 24 hours.</p>
          <p>If you did not request this, please ignore this email.</p>
        `
      });

      res.status(200).json({ message: 'Password reset email sent' });
    } catch (error) {
      sendErrorResponse(res, 500, 'Server error', [{ msg: error.message }]);
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
      .notEmpty().withMessage('Token is required')
      .isLength({ min: 64, max: 64 }).withMessage('Invalid token format'),
    body('id')
      .notEmpty().withMessage('User ID is required')
      .isUUID().withMessage('Invalid User ID format'),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/\d/).withMessage('Password must contain at least one number')
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
      .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { token, id, password } = req.body;

    try {
      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const userResult = await db.execute({
        sqlText: `
          SELECT USER_ID, EMAIL, RESET_PASSWORD_EXPIRES 
          FROM trade.gwtrade.USERS
          WHERE USER_ID = ? AND RESET_PASSWORD_TOKEN = ? AND RESET_PASSWORD_EXPIRES > CURRENT_TIMESTAMP()
        `,
        binds: [id, resetTokenHash],
      });

      if (!userResult || userResult.length === 0) {
        return sendErrorResponse(res, 400, 'Invalid or expired password reset token');
      }

      const user = userResult[0];
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      await db.execute({
        sqlText: `
          UPDATE trade.gwtrade.USERS
          SET PASSWORD_HASH = ?, RESET_PASSWORD_TOKEN = NULL, RESET_PASSWORD_EXPIRES = NULL
          WHERE USER_ID = ?
        `,
        binds: [hashedPassword, user.USER_ID],
      });

      await sendEmail({
        to: user.EMAIL,
        subject: 'Password Reset Successful',
        html: `
          <h1>Password Reset Successful</h1>
          <p>Your password has been successfully reset.</p>
          <p>If you did not perform this action, please contact our support immediately.</p>
          <p>Best regards,<br/>Support Team</p>
        `
      });

      res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
      sendErrorResponse(res, 500, 'Server error', [{ msg: error.message }]);
    }
  }
);

module.exports = router;