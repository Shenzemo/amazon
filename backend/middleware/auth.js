const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // THE FIX: Fetch the complete user object. Mongoose's .select('-password')
    // is sufficient and safer than relying on default schema projections.
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
        return res.status(401).json({ success: false, message: 'User not found' });
    }
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error); // Added for better debugging
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};
