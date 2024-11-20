const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Helper function for consistent error responses
const sendErrorResponse = (res, status, message, errors = null) => {
  const response = { message };
  if (errors) response.errors = errors;
  res.status(status).json(response);
};

// User Registration Route
router.post(
  '/register',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('full_name').notEmpty().withMessage('Full name is required'),
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
      const checkUserSql = 'SELECT * FROM trade.gwtrade.USERS WHERE USERNAME = ?';
      logger.info('Executing SQL:', checkUserSql);
      const existingUserResult = await db.execute({
        sqlText: checkUserSql,
        binds: [username],
      });

      if (existingUserResult && existingUserResult.length > 0) {
        return sendErrorResponse(res, 400, 'Username already exists');
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const USER_ID = uuidv4();

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
        ],
      });

      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      logger.error('Registration error:', error);
      sendErrorResponse(res, 500, 'Server error', [{ msg: error.message }]);
    }
  }
);

// User Login Route
router.post(
  '/login',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendErrorResponse(res, 400, 'Validation failed', errors.array());
    }

    const { username, password } = req.body;

    try {
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
      sendErrorResponse(res, 500, 'Server error', [{ msg: error.message }]);
    }
  }
);

module.exports = router;
