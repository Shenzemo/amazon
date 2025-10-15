const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protectAdmin = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
        return res.status(401).json({ success: false, message: 'User not found' });
    }

    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'User is not an admin' });
    }

    next();
  } catch (error) {
    console.error("Admin Auth Middleware Error:", error);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};
