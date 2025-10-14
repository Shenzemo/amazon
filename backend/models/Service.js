const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  service: { type: String, required: true },
  service_persian: { type: String, required: true },
  country: { type: String, required: true },
  country_persian: { type: String, required: true },
  country_code: { type: String },
  operator: { type: String, required: true },
  price_toman: { type: Number, required: true },
  priority: { type: Number, default: 99 },
  available: { type: Boolean, required: true },
  success_rate: { type: Number, default: 0 },
  provider: { type: String, required: true },
});

module.exports = mongoose.model('Service', ServiceSchema);
