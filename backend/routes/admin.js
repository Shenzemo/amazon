const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const { protectAdmin } = require('../middleware/adminAuth');

// All routes in this file are protected and can only be accessed by admins

// ... existing user routes ...
router.get('/users', protectAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

router.put('/users/:id', protectAdmin, async (req, res) => {
    try {
        const { balance, isAdmin } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.balance = balance;
        user.isAdmin = isAdmin;

        await user.save();
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});


// Get all orders
router.get('/orders', protectAdmin, async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'username email').sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// NEW: Update an order
router.put('/orders/:id', protectAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Add more fields here if needed in the future
        order.status = status;

        await order.save();
        
        // Populate user info before sending back
        const updatedOrder = await Order.findById(req.params.id).populate('user', 'username email');
        
        res.json({ success: true, order: updatedOrder, message: 'Order updated successfully' });
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({ success: false, message: 'Failed to update order' });
    }
});


// Get admin dashboard stats
router.get('/stats', protectAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalOrders = await Order.countDocuments();
        const totalSpentResult = await Order.aggregate([
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);

        res.json({
            success: true,
            stats: {
                totalUsers,
                totalOrders,
                totalSpent: totalSpentResult.length > 0 ? totalSpentResult[0].total : 0,
            }
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ success: false, message: 'Server error fetching stats' });
    }
});

// NEW: Advanced financial stats for charts
router.get('/financial-stats', protectAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 1. Daily revenue for the last 30 days
        const dailyRevenue = await Order.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo }, status: { $in: ['RECEIVED', 'FINISHED'] } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    total: { $sum: "$price" }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // 2. Top 5 services by revenue
        const topServices = await Order.aggregate([
            { $match: { status: { $in: ['RECEIVED', 'FINISHED'] } } },
            {
                $group: {
                    _id: "$service_name",
                    total: { $sum: "$price" }
                }
            },
            { $sort: { total: -1 } },
            { $limit: 5 }
        ]);

        res.json({
            success: true,
            stats: {
                dailyRevenue,
                topServices,
            }
        });
    } catch (error) {
        console.error('Error fetching financial stats:', error);
        res.status(500).json({ success: false, message: 'Server error fetching stats' });
    }
});

module.exports = router;

