// root.js

const express = require('express');
const serverless = require('serverless-http');

const app = express();

app.get('/', (req, res) => {
  res.send('Welcome to the Trade Platform Backend API');
});

module.exports.handler = serverless(app);
