// models/User.js

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['exporter', 'buyer'], required: true },
  // Additional fields based on role
});

module.exports = mongoose.model('User', UserSchema);
