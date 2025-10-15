// latest/backend/server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Models and Middleware
const User = require('./models/User');
const Order = require('./models/Order');
const Service = require('./models/Service');
const { protect } = require('./middleware/auth');
const adminRoutes = require('./routes/admin'); // Import admin routes

// Data helpers

const app = express();
const PORT = process.env.PORT || 3001;
const FIVESIM_API_KEY = process.env.FIVESIM_API_KEY;
const SMS_ACTIVATE_API_KEY = process.env.SMS_ACTIVATE_API_KEY;

// What was changed and why:
// The original implementation used a single conversion rate. This has been corrected
// to use two separate rates, one for USD (for sms-activate) and one for RUB (for 5sim).
let usdToTomanRate = 0;
let rubToTomanRate = 0;

async function updateCurrencyRates() {
    try {
        const response = await axios.get('https://sarfe.erfjab.com/api/prices');
        usdToTomanRate = response.data.usd1;
        rubToTomanRate = response.data.rub1;
        console.log(`Successfully updated currency rates on server start. USD to Toman: ${usdToTomanRate}, RUB to Toman: ${rubToTomanRate}`);
    } catch (error) {
        console.error('Failed to fetch currency rates on server start, using fallback.', error);
        usdToTomanRate = parseFloat(process.env.USD_TO_TOMAN_RATE) || 112800;
        rubToTomanRate = parseFloat(process.env.RUB_TO_TOMAN_RATE) || 1395;
    }
}
// Validate required environment variables
if (!process.env.JWT_SECRET || !FIVESIM_API_KEY || !SMS_ACTIVATE_API_KEY) {
  console.error('❌ FATAL ERROR: JWT_SECRET, FIVESIM_API_KEY, and SMS_ACTIVATE_API_KEY must be defined in .env file');
  process.exit(1);
}

// --- Middleware ---
app.use(cors({
  origin: [
    'https://cvk33w-5173.csb.app',
    'https://*.csb.app',
    'https://codesandbox.io',
    'http://localhost:3000',
    'http://localhost:5173',
    /^https:\/\/.*\.csb\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  optionsSuccessStatus: 200
}));
app.use(express.json());

// --- API Clients ---
const fiveSimClient = axios.create({
  baseURL: 'https://5sim.net/v1',
  headers: {
    'Authorization': `Bearer ${FIVESIM_API_KEY}`,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  },
});

const smsActivateClient = axios.create({
  baseURL: 'https://api.sms-activate.ae/stubs/handler_api.php',
  headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  },
});


// --- Simple In-Memory Cache for Services ---
let servicesCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = (parseInt(process.env.SMSA_CACHE_TTL_SECONDS, 10) || 300) * 1000; // 5 minutes default

// =================================================================
// --- ADMIN ROUTES ---
// =================================================================
app.use('/api/admin', adminRoutes);


// =================================================================
// --- AUTHENTICATION ROUTES ---
// =================================================================

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
        return res.status(400).json({ success: false, message: 'ایمیل یا نام کاربری قبلاً استفاده شده است' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    await User.create({ username, email, password: hashedPassword });
    res.status(201).json({ success: true, message: 'User registered successfully' });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
    const { loginIdentifier, password } = req.body;
    if (!loginIdentifier || !password) {
        return res.status(400).json({ success: false, message: 'Please provide credentials' });
    }

    try {
        const user = await User.findOne({ $or: [{ email: loginIdentifier }, { username: loginIdentifier }] });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: 'نام کاربری یا رمز عبور اشتباه است' });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                bookmarkedServices: user.bookmarkedServices,
                isAdmin: user.isAdmin
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
});

// =================================================================
// --- USER ROUTES (AUTHENTICATED) ---
// =================================================================

app.get('/api/balance', protect, (req, res) => {
    res.json({ success: true, amount: req.user.balance });
});

app.get('/api/orders', protect, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

app.get('/api/orders/active', protect, async (req, res) => {
    try {
        const activeOrders = await Order.find({
            user: req.user.id,
            status: { $in: ['PENDING', 'RECEIVED', 'ACTIVE'] }
        }).sort({ createdAt: -1 });
        res.json(activeOrders);
    } catch (error) {
        console.error('Error fetching active orders:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch active orders' });
    }
});

app.get('/api/check-order/:id', protect, async (req, res) => {
    const { id } = req.params;
    try {
        const internalOrder = await Order.findOne({ orderId_5sim: id, user: req.user.id });
        if (!internalOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }

        let data;
        if (internalOrder.provider === 'sms-activate') {
            const response = await smsActivateClient.get('', {
                params: { api_key: SMS_ACTIVATE_API_KEY, action: 'getStatus', id }
            });
            const responseText = response.data;
            if (responseText.startsWith('STATUS_OK')) {
                data = { status: 'RECEIVED', sms: [{ code: responseText.split(':')[1] }] };
            } else if (responseText === 'STATUS_WAIT_CODE') {
                data = { status: 'PENDING' };
            } else {
                data = { status: 'FINISHED' }; // Or map other statuses
            }
        } else {
            const response = await fiveSimClient.get(`/user/check/${id}`);
            data = response.data;
        }

        // Only process status changes if the order is still considered active in our DB
        if (['PENDING', 'ACTIVE'].includes(internalOrder.status)) {
            if (data.status === 'RECEIVED' && data.sms && data.sms.length > 0) {
                internalOrder.status = 'RECEIVED';
                internalOrder.smsCode = data.sms[0].code;
                await internalOrder.save();
                 // Mark as finished on sms-activate
                if (internalOrder.provider === 'sms-activate') {
                    await smsActivateClient.get('', { params: { api_key: SMS_ACTIVATE_API_KEY, action: 'setStatus', status: 6, id } });
                }

            } else if (data.status === 'TIMEOUT' || data.status === 'CANCELED') {
                await User.findByIdAndUpdate(req.user.id, { $inc: { balance: internalOrder.price } });
                internalOrder.status = data.status;
                await internalOrder.save();
            } else if (data.status === 'FINISHED') {
                internalOrder.status = 'FINISHED';
                await internalOrder.save();
            }
        }

        res.json(data);

    } catch (error) {
        const errorMessage = error.response?.data || 'An unknown error occurred';
        console.error(`Failed to check order ${id}:`, errorMessage);
        res.status(400).json({ message: errorMessage });
    }
});


app.post('/api/user/bookmarks/toggle', protect, async (req, res) => {
    const { serviceId } = req.body;
    if (!serviceId) {
        return res.status(400).json({ success: false, message: 'Service ID is required' });
    }
    try {
        const user = req.user;
        const index = user.bookmarkedServices.indexOf(serviceId);
        if (index > -1) {
            user.bookmarkedServices.splice(index, 1);
        } else {
            user.bookmarkedServices.push(serviceId);
        }
        await user.save();
        res.json({ success: true, bookmarks: user.bookmarkedServices });
    } catch (error) {
        console.error('Error toggling bookmark:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/dashboard-stats', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const totalOrders = await Order.countDocuments({ user: userId });
        const spendingAggregation = await Order.aggregate([
            { $match: { user: userId, status: { $in: ['FINISHED', 'RECEIVED', 'ACTIVE', 'PENDING'] } } },
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);
        const totalSpent = spendingAggregation.length > 0 ? spendingAggregation[0].total : 0;
        const activeOrders = await Order.countDocuments({ user: userId, status: { $in: ['ACTIVE', 'PENDING', 'RECEIVED'] } });
        res.json({
            success: true,
            stats: {
                balance: req.user.balance,
                totalOrders,
                totalSpent,
                activeOrders,
                bookmarkedServices: req.user.bookmarkedServices
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ success: false, message: 'Server error fetching stats' });
    }
});

app.post('/api/purchase', protect, async (req, res) => {
    const { service_id } = req.body;
    if (!service_id) {
        return res.status(400).json({ message: 'Service ID is required.' });
    }

    try {
        if (!servicesCache) {
            return res.status(503).json({ message: 'سرویس موقتا در دسترس نیست، لطفا چند لحظه دیگر تلاش کنید' });
        }

        const serviceDetails = servicesCache.find(s => s.id === service_id);
        if (!serviceDetails) {
            return res.status(404).json({ message: "سرویس انتخاب شده یافت نشد." });
        }
        const price_toman = serviceDetails.price_toman;

        if (req.user.balance < price_toman) {
            return res.status(402).json({ message: 'اعتبار شما کافی نیست' });
        }

        let orderData;

        if (serviceDetails.provider === 'sms-activate' && process.env.SMS_ACTIVATE_API_KEY) {
            const smsActivateCountriesRes = await smsActivateClient.get('', { params: { api_key: SMS_ACTIVATE_API_KEY, action: 'getCountries' }});
            const smsActivateCountries = smsActivateCountriesRes.data;
            const countryEntry = Object.entries(smsActivateCountries).find(([id, data]) => data.eng === serviceDetails.country);

            if (!countryEntry) { return res.status(400).json({ message: `Country ID for ${serviceDetails.country} not found.`}); }
            const countryId = countryEntry[0];

            const response = await smsActivateClient.get('', {
                params: {
                    api_key: SMS_ACTIVATE_API_KEY,
                    action: 'getNumber',
                    service: serviceDetails.service,
                    country: countryId
                }
            });
            const responseText = response.data;
            if (responseText.includes('ACCESS_NUMBER')) {
                const parts = responseText.split(':');
                orderData = { id: parts[1], phone: parts[2], expires: new Date(Date.now() + 20 * 60 * 1000) };
            } else {
                throw new Error(responseText);
            }

        } else if (serviceDetails.provider === '5sim') {
             const [_, service, country, operator] = serviceDetails.id.split('_');
             const purchaseResponse = await fiveSimClient.get(`/user/buy/activation/${country}/${operator}/${service}`);
             orderData = purchaseResponse.data;
        }


        if (!orderData || !orderData.id) {
            return res.status(409).json({ message: "این سرویس در حال حاضر موجود نیست." });
        }

        await User.findByIdAndUpdate(req.user.id, { $inc: { balance: -price_toman } });

        const newOrder = await Order.create({
            user: req.user.id,
            orderId_5sim: orderData.id,
            provider: serviceDetails.provider,
            serviceId: service_id,
            service_name: serviceDetails.service_persian,
            country: serviceDetails.country_persian,
            country_code: serviceDetails.country_code,
            number: orderData.phone,
            price: price_toman,
            status: 'PENDING',
            expiresAt: new Date(orderData.expires)
        });

        res.json({
            order: newOrder,
        });

    } catch (error) {
        console.error('Purchase failure:', error);
        const apiError = error.response?.data || error.message;
        if (typeof apiError === 'string' && (apiError.toLowerCase().includes('no product') || apiError.toLowerCase().includes('no free phones') || apiError.toLowerCase().includes('no_numbers'))) {
            return res.status(409).json({ message: "این سرویس در حال حاضر موجود نیست. لطفا سرویس دیگری را امتحان کنید." });
        }
        res.status(500).json({ message: "خرید انجام نشد. لطفا دوباره تلاش کنید." });
    }
});

app.post('/api/cancel-order/:id', protect, async (req, res) => {
    const { id } = req.params;
    try {
        const internalOrder = await Order.findOne({ orderId_5sim: id, user: req.user.id });
        if (!internalOrder) {
            return res.status(404).json({ message: "سفارش یافت نشد." });
        }

        if (['CANCELED', 'TIMEOUT', 'FINISHED', 'RECEIVED'].includes(internalOrder.status)) {
            return res.status(400).json({ message: "این سفارش قبلا به پایان رسیده است." });
        }

        let responseData;

        if(internalOrder.provider === 'sms-activate') {
            const response = await smsActivateClient.get('', { params: { api_key: SMS_ACTIVATE_API_KEY, action: 'setStatus', status: 8, id } });
            if(response.data === 'ACCESS_CANCEL') {
                responseData = { status: 'CANCELED' };
            } else {
                 throw new Error(response.data);
            }
        } else {
            const response = await fiveSimClient.get(`/user/cancel/${id}`);
            responseData = response.data;
        }


        if (responseData.status === 'CANCELED') {
            await User.findByIdAndUpdate(req.user.id, { $inc: { balance: internalOrder.price } });
            internalOrder.status = 'CANCELED';
            await internalOrder.save();
        }

        res.json(responseData);

    } catch (error) {
        const errorMessage = error.response?.data || error.message || 'An unknown error occurred';
        console.error(`Failed to cancel order ${id}:`, errorMessage);

        // Fallback refund logic if cancellation fails due to timeout
        if (typeof errorMessage === 'string' && (errorMessage.toUpperCase().includes('TIMEOUT') || errorMessage.toUpperCase().includes('ORDER HAS ALREADY BEEN FINISHED'))) {
            const internalOrder = await Order.findOne({ orderId_5sim: id, user: req.user.id });
            if (internalOrder && !['CANCELED', 'RECEIVED'].includes(internalOrder.status)) {
                await User.findByIdAndUpdate(req.user.id, { $inc: { balance: internalOrder.price } });
                internalOrder.status = 'TIMEOUT';
                await internalOrder.save();
                return res.json({ status: 'TIMEOUT', message: 'Order timed out and has been refunded.' });
            }
        }

        res.status(400).json({ message: errorMessage });
    }
});


// =================================================================
// --- GUEST ROUTES (UNPROTECTED) ---
// =================================================================
app.post('/api/purchase-guest', async (req, res) => { res.status(501).json({message: "Not Implemented"}) });
app.get('/api/check-order-guest/:guestId/:id', async (req, res) => { res.status(501).json({message: "Not Implemented"}) });

// =================================================================
// --- PUBLIC ROUTES ---
// =================================================================
app.get('/api/services', async (req, res) => {
  const now = Date.now();
  if (servicesCache && now - cacheTimestamp < CACHE_DURATION) {
    console.log('Serving services from cache.');
    return res.json(servicesCache);
  }

  try {
    console.log('Fetching services from database...');
    // REMOVED SORT: Sorting 150k+ documents is memory-intensive and can cause timeouts.
    // The frontend will handle sorting smaller, filtered lists.
    const servicesFromDB = await Service.find({}).lean();
    console.log(`✅ Found ${servicesFromDB.length} services in DB.`);

    servicesCache = servicesFromDB;
    cacheTimestamp = now;

    res.json(servicesCache);
  } catch (error) {
    console.error('CRITICAL: Error fetching services from DB:', error);
    res.status(500).json({ message: 'Failed to fetch services.' });
  }
});

// =================================================================
// --- Utility Functions & Server Start ---
// =================================================================

const startServer = async () => {
  try {
    await updateCurrencyRates(); // Fetch currency rates on startup
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected!');
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

startServer();
