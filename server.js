import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import MongoStore from 'connect-mongo';
import Recipient from './models/Recipient.js';
import fetch from 'node-fetch';
import axios from 'axios';
import { sendEmail, welcomeEmail, followUpReminder } from './services/emailService.js';
import cron from 'node-cron';
import SystemUser from './models/SystemUser.js';
import twilio from 'twilio';
import fs from 'fs';
import dayjs from 'dayjs'; 


// Create __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // 👈 Add this line

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: 'http://localhost:3000',  
    credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'RCCG_TOP',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
        //domain: '.onrender.com
    },
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/followups' })
}));

const sessionStore = MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/followups' });
sessionStore.on('connected', () => console.log('✅ Session store connected to MongoDB'));
sessionStore.on('error', (err) => console.error('❌ Session store error:', err));

app.use(session({
    // ... 
    store: sessionStore
}));

app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.url} - Session ID: ${req.session.id}, User: ${req.session.userId}`);
    next();
});

// ==================== DATABASE CONNECTION ====================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/followups')
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.error('MongoDB connection error:', error));

// ==================== SCHEMAS & MODELS ====================
const userSchema = new mongoose.Schema({
    name: String,
    phone: String,
    address: String,
    email: String,
    date: String,
    comment: String
});

const followUpSchema = new mongoose.Schema({
    name: String,
    status: String,
    recentFollowUp: String,
    byWho: String,
    dateFollowedUp: String,
    phoneNumber: String,
    email: { type: String, default: '' },
    lastReminderSent: { type: Date, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    message: String,
    timestamp: { type: Date, default: Date.now }
});

const attendanceSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: {
        type: String,
        required: true,
        enum: ['Children', 'Youth', 'Married', 'Single', 'Elder'],
        default: 'Youth'
    },
    gender: {
        type: String,
        enum: ['Male', 'Female'],
        required: true,
        trim: true
    },
    phone: {
        type: String,
        validate: {
            validator: function(v) {
                return /^\+?[\d\s-]{10,}$/.test(v);
            },
            message: props => `${props.value} is not a valid phone number!`
        }
    },
    date: {
        type: Date,
        required: true,
        set: function(v) {
            if (typeof v === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                    return new Date(v + 'T00:00:00');
                }
                return new Date(v);
            }
            return v;
        },
    },
    serviceType: {
        type: String,
        enum: ['Sunday Service', 'Bible Study', 'Prayer Meeting', 'Special Program', 'Midweek Service'],
        default: 'Sunday Service'
    },
    checkedIn: { type: Boolean, default: true },
    checkedInTime: { type: Date, default: Date.now },
    checkedOutTime: Date,
    notes: { type: String, maxlength: 500 },
    createdBy: { type: String, default: 'System' }
}, { timestamps: true });

// Indexes
attendanceSchema.index({ date: -1, category: 1 });
attendanceSchema.index({ name: 'text', phone: 'text' });
attendanceSchema.index(
    { phone: 1, date: 1, serviceType: 1 },
    { unique: true, partialFilterExpression: { phone: { $exists: true, $ne: null } } }
);

const User = mongoose.model('User', userSchema);
const FollowUp = mongoose.model('FollowUp', followUpSchema);
const Message = mongoose.model('Message', messageSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ==================== HELPER FUNCTIONS ====================
function formatPhoneForTwilio(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '233' + cleaned.substring(1);
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return cleaned.length === 13 ? cleaned : null;
}

async function sendSms(phoneNumber, message) {
    if (!phoneNumber) return { success: false, error: 'No phone number' };
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        const result = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });
        console.log('📲 Twilio response:', result.status, result.sid);
        return { success: true, sid: result.sid, status: result.status };
    } catch (error) {
        console.error('Twilio SMS error:', error);
        return { success: false, error: error.message };
    }
}

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login.html');
}

function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session.role) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        if (!allowedRoles.includes(req.session.role)) {
            return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
        }
        next();
    };
}

// ==================== CRON JOB ====================
cron.schedule('0 8 * * *', async () => {
    console.log('Running overdue follow‑up check...');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const overdue = await FollowUp.find({ dateFollowedUp: { $lt: cutoff } });

    if (overdue.length === 0) {
        console.log('No overdue follow‑ups.');
        return;
    }

    const today = new Date();
    const reminderIntervalDays = 7;

    // Summary email
    const summaryHtml = `<h3>Overdue Follow‑ups (${overdue.length})</h3><ul>${overdue.map(f => `<li>${f.name} – ${f.recentFollowUp || 'No note'}</li>`).join('')}</ul>`;
    await sendEmail(process.env.PASTOR_EMAIL || 'pastor@church.com', 'Overdue Follow‑ups Summary', summaryHtml);

    // Individual reminders
    for (const fu of overdue) {
        let shouldSend = false;
        if (!fu.lastReminderSent) {
            shouldSend = true;
        } else {
            const daysSinceLastReminder = (today - fu.lastReminderSent) / (1000 * 3600 * 24);
            if (daysSinceLastReminder >= reminderIntervalDays) {
                shouldSend = true;
            }
        }

        if (!shouldSend) {
            console.log(`Skipping reminder for ${fu.name} (last sent ${fu.lastReminderSent})`);
            continue;
        }

        if (fu.phoneNumber) {
            const formattedPhone = formatPhoneForTwilio(fu.phoneNumber);
            if (formattedPhone) {
                const smsMessage = `Hello ${fu.name}, your last follow‑up was on ${dayjs(fu.dateFollowedUp).format('MMM D, YYYY')}. Please contact the church office to catch up.`;
                const smsResult = await sendSms(formattedPhone, smsMessage);
                if (smsResult.success) {
                    console.log(`SMS sent to ${fu.name} (${formattedPhone})`);
                } else {
                    console.error(`Failed to send SMS to ${fu.name}: ${smsResult.error}`);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const recipientEmail = process.env.PASTOR_EMAIL || 'pastor@church.com';
        const individualHtml = followUpReminder(fu.name, fu.recentFollowUp || 'No note');
        await sendEmail(recipientEmail, `Follow‑up Reminder: ${fu.name}`, individualHtml);

        fu.lastReminderSent = today;
        await fu.save();
        console.log(`Reminder sent for ${fu.name} (last sent updated to ${today})`);
    }
    console.log('All reminders processed.');
});

// ==================== ROUTES ====================
app.get('/api/session-test', (req, res) => {
    res.json({
        sessionId: req.session.id,
        userId: req.session.userId,
        role: req.session.role
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
});

// ---- Public routes ----
app.get('/', (req, res) => {
    const filePath = path.join(process.cwd(), 'public', 'login.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('File not found: ' + filePath);
    }
});

// Debug routes (remove after testing)
app.get('/debug-files', (req, res) => {
    const dir = path.join(process.cwd(), 'public');
    fs.readdir(dir, (err, files) => {
        if (err) {
            res.status(500).send('Error reading directory: ' + err.message);
        } else {
            res.json(files);
        }
    });
});

app.get('/debug-ls', (req, res) => {
    const cwd = process.cwd();
    const publicPath = path.join(cwd, 'public');
    let output = `<h3>Current directory: ${cwd}</h3><ul>`;
    try {
        const files = fs.readdirSync(cwd);
        output += files.map(f => `<li>${f}</li>`).join('');
        output += `</ul><h3>Public folder (${publicPath}):</h3><ul>`;
        if (fs.existsSync(publicPath)) {
            const publicFiles = fs.readdirSync(publicPath);
            output += publicFiles.map(f => `<li>${f}</li>`).join('');
        } else {
            output += `<li>⚠️ Public folder not found</li>`;
        }
        output += `</ul>`;
        res.send(output);
    } catch (err) {
        res.status(500).send(`Error: ${err.message}`);
    }
});

app.get('/seed', async (req, res) => {
    try {
        const existing = await SystemUser.findOne({ username: 'Topadmin' });
        if (!existing) {
            const hashed = bcrypt.hashSync('password123', 10);
            await SystemUser.create({
                username: 'Topadmin',
                passwordHash: hashed,
                role: 'admin',
                fullName: 'Super Admin'
            });
            res.send('Admin user created.');
        } else {
            res.send('Admin already exists.');
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ---- Protected HTML pages ----
// ---- Protected HTML pages ----
app.get('/index.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});
app.get('/followup.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'followup.html'));
});
app.get('/attendance.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'attendance.html'));
});
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
});
app.get('/users.html', isAuthenticated, authorize('admin'), (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'users.html'));
});

// ---- API Routes ----
app.get('/api/me', isAuthenticated, (req, res) => {
    res.json({
        username: req.session.username || 'Topadmin',
        role: req.session.role || 'admin',
        fullName: req.session.fullName || 'Administrator'
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await SystemUser.findOne({ username });
        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        const match = bcrypt.compareSync(password, user.passwordHash);
        if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        
        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.fullName = user.fullName;

        // Force save and check for errors
        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.status(500).json({ success: false, message: 'Session save failed' });
            }
            console.log('✅ Session saved successfully for user:', user.username);
            res.json({ success: true, message: 'Login successful', role: user.role });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Member routes
app.get('/api/users', isAuthenticated, async (req, res) => {
    const users = await User.find().sort({ _id: -1 });
    res.json(users);
});
app.get('/api/users/:id', isAuthenticated, async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Member not found' });
    res.json(user);
});
app.get('/api/users/search', isAuthenticated, async (req, res) => {
    const { name } = req.query;
    const users = await User.find({ name: new RegExp(name, 'i') });
    res.json(users);
});
app.post('/api/users', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => {
    const { name, phone, address, email, date, comment } = req.body;
    if (await User.findOne({ phone })) return res.status(400).json({ message: 'Phone already exists' });
    const newUser = new User({ name, phone, address, email, date, comment });
    await newUser.save();
    res.status(201).json(newUser);
});
app.put('/api/users/:id', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => {
    const { name, phone, address, email, date, comment } = req.body;
    const updated = await User.findByIdAndUpdate(
        req.params.id,
        { name, phone, address, email, date, comment },
        { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Member not found' });
    res.json(updated);
});
app.delete('/api/users/:id', isAuthenticated, authorize('admin'), async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
});

// Follow-up routes
app.get('/api/followups', async (req, res) => {
    const { range = 'all', status } = req.query;
    console.log('GET /api/followups - range:', range, 'status:', status);
    try {
        let baseQuery = {
            $or: [
                { dateFollowedUp: { $type: "string", $regex: /^\d{4}-\d{2}-\d{2}$/ } },
                { dateFollowedUp: { $type: "date" } }
            ]
        };
        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            if (statuses.length > 0) baseQuery.status = { $in: statuses };
        }
        let followUps = await FollowUp.find(baseQuery).lean();
        const now = new Date();
        const normalized = followUps.map(doc => {
            let dateObj;
            if (typeof doc.dateFollowedUp === 'string') dateObj = new Date(doc.dateFollowedUp);
            else if (doc.dateFollowedUp instanceof Date) dateObj = doc.dateFollowedUp;
            else return null;
            if (isNaN(dateObj)) return null;
            return { ...doc, dateObj };
        }).filter(Boolean);
        let filtered = normalized;
        if (range !== 'all') {
            let cutoff = new Date();
            if (range === '7') cutoff.setDate(now.getDate() - 7);
            else if (range === '30') cutoff.setDate(now.getDate() - 30);
            else if (range === '90') cutoff.setDate(now.getDate() - 90);
            else if (range === '365') cutoff = new Date(now.getFullYear() - 1, 0, 1);
            filtered = normalized.filter(f => f.dateObj >= cutoff);
        }
        filtered.sort((a, b) => b.dateObj - a.dateObj);
        const result = filtered.map(({ dateObj, ...rest }) => rest);
        console.log(`Returning ${result.length} follow-ups`);
        res.json(result);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});
app.get('/api/followups/:id', isAuthenticated, async (req, res) => {
    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ message: 'Not found' });
    res.json(followUp);
});
app.post('/api/followups', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => {
    const { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber } = req.body;
    if (await FollowUp.findOne({ name })) return res.status(400).json({ message: 'Name already exists' });
    const newFollowUp = new FollowUp({ name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber });
    await newFollowUp.save();
    res.status(201).json(newFollowUp);
});
app.put('/api/followups/:id', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => {
    const { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber } = req.body;
    const updated = await FollowUp.findByIdAndUpdate(
        req.params.id,
        { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber },
        { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
});
app.delete('/api/followups/:id', isAuthenticated, authorize('admin'), async (req, res) => {
    await FollowUp.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard-stats', async (req, res) => {
    try {
        const { range = '30', status } = req.query;

        let query = {};
        if (status) {
            query.status = status;
        }

        const followUps = await FollowUp.find(query).lean();

        const now = new Date();
        let cutoff = new Date();

        if (range === '7') cutoff.setDate(now.getDate() - 7);
        else if (range === '30') cutoff.setDate(now.getDate() - 30);
        else if (range === '90') cutoff.setDate(now.getDate() - 90);
        else if (range === 'all') cutoff = new Date(0);

        const filteredFollowUps = followUps.filter(fu => {
            if (!fu.dateFollowedUp) return range === 'all';
            return new Date(fu.dateFollowedUp) >= cutoff;
        });

        const statusBreakdown = {
            Regular: 0,
            Irregular: 0,
            Visitor: 0,
            'First Timer': 0,
            total: filteredFollowUps.length
        };

        filteredFollowUps.forEach(fu => {
            const st = fu.status?.trim();
            if (st && statusBreakdown.hasOwnProperty(st)) {
                statusBreakdown[st]++;
            } else if (st) {
                statusBreakdown.Irregular++;
            }
        });

        const overdue = filteredFollowUps.filter(fu => {
            if (!fu.dateFollowedUp) return true;
            return new Date(fu.dateFollowedUp) < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }).length;

        const newVisitors = filteredFollowUps.filter(fu => {
            return ['Visitor', 'First Timer'].includes(fu.status) &&
                   new Date(fu.dateFollowedUp || fu.createdAt || now) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }).length;

        const trend = getFollowUpTrend(filteredFollowUps, 30);

        res.json({
            global: {
                totalFollowUps: statusBreakdown.total,
                regular: statusBreakdown.Regular,
                irregular: statusBreakdown.Irregular,
                newVisitors: newVisitors,
                overdue: overdue
            },
            statusBreakdown,
            trend: trend,
            users: filteredFollowUps.slice(0, 30)
        });

    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({ message: error.message });
    }
});

// Helper function (already exists, but ensure it's defined)
function getFollowUpTrend(followUps, days = 30) {
    const trend = {};
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        trend[date.toISOString().split('T')[0]] = 0;
    }
    followUps.forEach(fu => {
        if (fu.dateFollowedUp) {
            const dateStr = new Date(fu.dateFollowedUp).toISOString().split('T')[0];
            if (trend[dateStr] !== undefined) trend[dateStr]++;
        }
    });
    return Object.keys(trend).map(date => ({ date, count: trend[date] }));
}

app.post('/api/attendance', async (req, res) => {
    console.log('POST /api/attendance:', req.body);
    try {
let { name, phone, date, serviceType, category, gender, notes } = req.body;
        let normalizedPhone = null;
        if (phone && typeof phone === 'string') {
            // Remove all non-digits
            normalizedPhone = phone.replace(/\D/g, '');

            // Handle common Ghana formats: 0xxxxxxxxx → +233xxxxxxxxx
            if (normalizedPhone.startsWith('0') && normalizedPhone.length === 10) {
                normalizedPhone = '233' + normalizedPhone.substring(1);
            }
            // Add + prefix if not present
            if (!normalizedPhone.startsWith('+')) {
                normalizedPhone = '+' + normalizedPhone;
            }

            // Optional: enforce length for Ghana numbers
            if (normalizedPhone.length !== 13) { // +233xxxxxxxxx = 13 chars
                return res.status(400).json({ message: 'Invalid phone number format' });
            }
        }

        // ── Duplicate check with normalized phone ──
        if (normalizedPhone) {
            const checkDate = new Date(date);
            checkDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(checkDate);
            nextDay.setDate(nextDay.getDate() + 1);

            const existing = await Attendance.findOne({
                phone: normalizedPhone,
                date: { $gte: checkDate, $lt: nextDay },
                serviceType
            });

            if (existing) {
                return res.status(409).json({ 
                    message: `This phone number (${normalizedPhone}) has already been checked in for ${serviceType} today.`,
                    existingRecord: {
                        _id: existing._id,
                        name: existing.name,
                        checkInTime: existing.checkedInTime
                    }
                });
            }
        }

        // Save with normalized phone
        const attendanceData = {
            name,
            category,
            gender,                   
            phone: normalizedPhone,
            date,
            serviceType,
            notes: notes || ''         
        };
        const attendance = new Attendance(attendanceData);
        await attendance.save();
        res.status(201).json(attendance);

    } catch (error) {
    console.error('Attendance creation error:', error);

    if (error.code === 11000) {
        return res.status(409).json({
            success: false,
            message: `Phone ${req.body.phone || '(unknown)'} has already been checked in today for ${req.body.serviceType || 'this service'}.`,
            errorType: 'duplicate_checkin',
        });
    }

    // ← All other errors go here
    res.status(400).json({
        success: false,
        message: error.message || 'Check-in failed',
        details: error.errors 
            ? Object.keys(error.errors).map(k => ({
                field: k,
                reason: error.errors[k].message
              }))
            : null
    });
}
});
app.get('/api/attendance', async (req, res) => {
    console.log('GET /api/attendance - Query:', req.query);
    try {
        const { 
            category, 
            date, 
            startDate, 
            endDate, 
            serviceType,
            checkedIn,
            page = 1, 
            limit = 50 
        } = req.query;

        const query = {};
        
        if (category) query.category = category;
        if (serviceType) query.serviceType = serviceType;
        if (checkedIn !== undefined) query.checkedIn = checkedIn === 'true';
        
        // Date filtering
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            query.date = { $gte: startOfDay, $lte: endOfDay };
        } else if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const skip = (page - 1) * limit;
        
        const attendance = await Attendance.find(query)
            .sort({ date: -1, checkedInTime: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Attendance.countDocuments(query);
        
        res.json({
            attendance,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/attendance/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayRecords = await Attendance.find({ date: { $gte: today, $lt: tomorrow } });
        
        const byCategory = { Children: 0, Youth: 0, Married: 0, Single: 0, Elder: 0 };
        const byGender = { Male: 0, Female: 0 };

        todayRecords.forEach(record => {
            if (record.category) byCategory[record.category] = (byCategory[record.category] || 0) + 1;
            if (record.gender) byGender[record.gender] = (byGender[record.gender] || 0) + 1;
        });

        res.json({
            today: {
                total: todayRecords.length,
                byCategory,
                byGender
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/attendance/:id', async (req, res) => {
    console.log('GET /api/attendance/:id - ID:', req.params.id);
    try {
        const record = await Attendance.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }
        res.json(record);
    } catch (error) {
        console.error('Error fetching attendance record:', error);
        res.status(500).json({ message: error.message });
    }
});

// @desc    Update attendance record (full update or checkout)
app.put('/api/attendance/:id', async (req, res) => {
    console.log('PUT /api/attendance/:id - ID:', req.params.id, 'Body:', req.body);
    try {
        const { id } = req.params;
        const { checkedOut, name, category, gender, phone, serviceType, date, notes } = req.body;

        let updateData = {};

        // If it's a checkout action
        if (checkedOut === true) {
            updateData = {
                checkedIn: false,
                checkedOutTime: new Date()
            };
        } 
        // If it's a full edit (all fields provided)
        else if (name && category && gender && serviceType && date) {
            updateData = {
                name,
                category,
                gender,
                phone: phone || '',
                serviceType,
                date: new Date(date),
                notes: notes || '',
                // preserve existing check-in status unless explicitly changed
                checkedIn: req.body.checkedIn !== undefined ? req.body.checkedIn : true
            };
        } 
        else {
            return res.status(400).json({ message: 'Invalid update data' });
        }

        const updated = await Attendance.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
        if (!updated) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Error updating attendance:', error);
        res.status(500).json({ message: error.message });
    }
});

// @desc    Delete attendance record
app.delete('/api/attendance/:id', async (req, res) => {
    console.log('DELETE /api/attendance/:id - ID:', req.params.id);
    try {
        const attendance = await Attendance.findByIdAndDelete(req.params.id);
        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }
        res.json({ message: 'Attendance record deleted' });
    } catch (error) {
        console.error('Error deleting attendance:', error);
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/attendance/export/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { startDate, endDate, category } = req.query;
        
        const query = {};
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }
        if (category) query.category = category;

        const attendance = await Attendance.find(query)
            .sort({ date: -1, category: 1 });

        if (type === 'csv') {
            // Updated: force phone as quoted string so Excel treats it as text
            const csvData = attendance.map(record => ({
                Name: record.name || '',
                Category: record.category || '',
                Gender: record.gender || '',
                Phone: record.phone ? `"${record.phone}"` : '',          // ← key fix: quotes around phone
                Service: record.serviceType || '',
                Date: record.date ? record.date.toISOString().split('T')[0] : '',
                'Check-in Time': record.checkedInTime 
                    ? record.checkedInTime.toLocaleString() 
                    : '',
                'Check-out Time': record.checkedOutTime 
                    ? record.checkedOutTime.toLocaleString() 
                    : 'Still checked in',
                Status: record.checkedIn ? 'Checked In' : 'Checked Out',
                Notes: record.notes || ''
            }));

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
            
            // Convert to CSV
            const csv = convertToCSV(csvData);
            res.send(csv);
        } else {
            res.json(attendance);
        }
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Helper function for CSV conversion (unchanged)
function convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','), // Header row
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                // Escape quotes and wrap in quotes if contains comma or is already quoted
                const escaped = String(value).replace(/"/g, '""');
                return escaped.includes(',') || escaped.startsWith('"') 
                    ? `"${escaped}"` 
                    : escaped;
            }).join(',')
        )
    ];
    
    return csvRows.join('\n');
}

app.post('/send-message', async (req, res) => {
    const { name, phone, message: customMessage } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ success: false, message: "Name and phone number are required" });
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const formattedPhone = phone.replace(/\D/g, '');
    
    // Ensure it starts with '+' for international format
    const toPhone = formattedPhone.startsWith('+') ? formattedPhone : `+${formattedPhone}`;

    const smsText = customMessage || `Welcome to RCCG Tabernacle Of Praise, ${name}. We are glad you are here!`;

    try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        const message = await client.messages.create({
            body: smsText,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: toPhone
        });
        
        // Optional: save to database
        await Message.create({ name, phone: formattedPhone, message: smsText });
        
        res.json({ success: true, message: "SMS sent successfully", messageSid: message.sid });
    } catch (error) {
        console.error("Twilio SMS error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

function formatPhoneForTwilio(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '233' + cleaned.substring(1);
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return cleaned.length === 13 ? cleaned : null;
}

async function sendSms(phoneNumber, message) {
    if (!phoneNumber) return { success: false, error: 'No phone number' };
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        const result = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });
        console.log('📲 Twilio response:', result.status, result.sid);
        return { success: true, sid: result.sid, status: result.status };
    } catch (error) {
        console.error('Twilio SMS error:', error);
        return { success: false, error: error.message };
    }
}

app.post('/api/send-email', isAuthenticated, async (req, res) => {
    const { to, subject, message, memberName, template } = req.body;
    if (!to) return res.status(400).json({ success: false, message: 'Recipient email is required' });

    let html = '';
    if (template === 'welcome' && memberName) {
        html = welcomeEmail(memberName);
    } else if (template === 'followup' && memberName && message) {
        html = followUpReminder(memberName, message);
    } else {
        html = `<p>${message || 'No additional message.'}</p>`;
    }

    const result = await sendEmail(to, subject || 'Message from RCCG TOP', html);
    if (result.success) {
        res.json({ success: true, message: 'Email sent successfully' });
    } else {
        res.status(500).json({ success: false, message: result.error });
    }
});

app.get('/api/debug-model', async (req, res) => {
    try {
        const modelInfo = {
            modelName: FollowUp.modelName,
            collectionName: FollowUp.collection.name,
            collectionDbName: FollowUp.collection.dbName,
            collectionNamespace: FollowU.p.collection.namespace
        };
        
        res.json(modelInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Test basic API connectivity
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!', timestamp: new Date() });
});

// Test database connectivity
app.get('/api/test-db', async (req, res) => {
    try {
        const dbState = mongoose.connection.readyState;
        const stateMap = {
            0: 'disconnected',
            1: 'connected', 
            2: 'connecting',
            3: 'disconnecting'
        };
        
        res.json({
            database: mongoose.connection.db.databaseName,
            connectionState: `${dbState} (${stateMap[dbState] || 'unknown'})`,
            collections: await mongoose.connection.db.listCollections().toArray()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Attendance routes
//app.get('/api/attendance', isAuthenticated, async (req, res) => { / });
//app.get('/api/attendance/stats', isAuthenticated, async (req, res) => { /* ... keep existing logic ... */ });
//app.get('/api/attendance/:id', isAuthenticated, async (req, res) => { /* ... keep existing logic ... */ });
//app.post('/api/attendance', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => { /* ... keep existing logic ... */ });
//app.put('/api/attendance/:id', isAuthenticated, authorize('admin', 'secretary'), async (req, res) => { /* ... keep existing logic ... */ });
//app.delete('/api/attendance/:id', isAuthenticated, authorize('admin'), async (req, res) => { /* ... keep existing logic ... */ });
//app.get('/api/attendance/search/:query', isAuthenticated, async (req, res) => { /* ... keep existing logic ... */ });
//app.get('/api/attendance/export/:type', isAuthenticated, async (req, res) => { /* ... keep existing logic ... */ });

app.get('/index.html', isAuthenticated, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/followup.html', isAuthenticated, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'followup.html'));
});

app.get('/attendance.html', isAuthenticated, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

app.get('/protected', isAuthenticated, (_req, res) => {
    res.send('Protected content');
});

app.get('/dashboard', isAuthenticated, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/get-email-by-name', isAuthenticated, async (req, res) => {
    const { name } = req.query;
    const user = await User.findOne({ name: new RegExp('^' + name + '$', 'i') });
    res.json({ email: user ? user.email : null });
});

app.get('/api/followups/stats', async (req, res) => {
    const total = await FollowUp.countDocuments();
    const regular = await FollowUp.countDocuments({ status: 'Regular' });
    res.json({ total, regular, irregular: total - regular });
});

// Test route to debug bulk SMS
app.get('/api/bulk-sms-test', (req, res) => {
    res.json({ message: 'Bulk SMS route is reachable!' });
});

app.post('/api/bulk-sms', isAuthenticated, async (req, res) => {
    try {
        console.log('📩 Bulk SMS request received:', req.body);
        const { phoneNumbers, message } = req.body;

        if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            console.log('❌ No phone numbers provided');
            return res.status(400).json({ success: false, message: 'No phone numbers provided' });
        }

        if (!message || message.trim().length === 0) {
            console.log('❌ Empty message');
            return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        }

        console.log(`📤 Sending bulk SMS to ${phoneNumbers.length} numbers`);

        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const phone of phoneNumbers) {
            const formattedPhone = formatPhoneForTwilio(phone);
            if (!formattedPhone) {
                console.log(`⚠️ Invalid phone: ${phone}`);
                results.push({ phone, success: false, error: 'Invalid phone format' });
                failureCount++;
                continue;
            }

            console.log(`📲 Sending to ${formattedPhone}...`);
            const smsResult = await sendSms(formattedPhone, message);
            if (smsResult.success) {
                successCount++;
                results.push({ phone, success: true, sid: smsResult.sid });
                console.log(`✅ Sent to ${formattedPhone}`);
            } else {
                failureCount++;
                results.push({ phone, success: false, error: smsResult.error });
                console.log(`❌ Failed to send to ${formattedPhone}: ${smsResult.error}`);
            }
            // Small delay to respect Twilio rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const responsePayload = {
            success: true,
            summary: { total: phoneNumbers.length, success: successCount, failure: failureCount },
            details: results
        };
        console.log('📤 Sending response:', responsePayload);
        res.json(responsePayload);
    } catch (error) {
        console.error('🔥 Bulk SMS error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

                                                            

// Other API routes (send-message, send-email, bulk-sms, etc.) – keep as is.

// ---- Static files (CSS, JS, images) ----
// This must come AFTER all route handlers to avoid intercepting .html routes
// ---- Static files (CSS, JS, images) ----
app.use(express.static(path.join(process.cwd(), 'public')));

// ---- Catch-all for missing routes (must be last) ----
app.get('/*splat', (req, res) => {
    console.log('404 - Route not found:', req.url);
    res.status(404).send('Page not found');
});
// ==================== START SERVER ====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log('Server time:', new Date().toString());
    console.log(`Server running on http://localhost:${port}`);
    console.log('Cron job scheduled for 8 AM daily');
    console.log('TWILIO_SID:', process.env.TWILIO_ACCOUNT_SID);
    console.log('TWILIO_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'exists' : 'missing');
});
