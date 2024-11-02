// models/Order.js

const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  ORDER_ID: { type: String, required: true },
  BUYER_ID: { type: String, required: true },
  TOTAL_AMOUNT: { type: Number, required: true },
  // You can add other fields as necessary
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
