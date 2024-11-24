// scheduler.js

const express = require('express');
const serverless = require('serverless-http');
const scheduler = require('./utils/scheduler'); // Your scheduler logic

const app = express();

app.get('/', async (req, res) => {
  try {
    await scheduler();
    res.status(200).json({ message: 'Scheduler executed successfully.' });
  } catch (error) {
    console.error('Scheduler execution failed:', error);
    res.status(500).json({ message: 'Scheduler execution failed.', error: error.message });
  }
});

module.exports = serverless(app);
