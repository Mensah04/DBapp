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


// Create __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for node-fetch
const app = express();

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));


// Database Connection
mongoose.connect('mongodb://localhost:27017/followups')
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.error('MongoDB connection error:', error));

// Schemas and Models
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
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});  // No collection override

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    message: String,
    timestamp: { type: Date, default: Date.now }
});

const attendanceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: ['Children', 'Youth', 'Married', 'Single', 'Elder'],
        default: 'Youth'
    },
    gender: {
        type: String,
        enum: ['Male', 'Female'],          // or add 'Other' if desired
        required: [true, 'Gender is required'],  // or false if optional
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
    // Add this setter to handle incoming strings safely
    set: function(v) {
        if (typeof v === 'string') {
            // Handle yyyy-mm-dd from <input type="date">
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                return new Date(v + 'T00:00:00');
            }
            // fallback to normal parsing
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
    checkedIn: {
        type: Boolean,
        default: true
    },
    checkedInTime: {
        type: Date,
        default: Date.now
    },
    checkedOutTime: Date,
    notes: {
        type: String,
        maxlength: 500
    },
    createdBy: {
        type: String,
        default: 'System'
    }
}, {
    timestamps: true
});

// Create indexes for better performance
attendanceSchema.index({ date: -1, category: 1 });
attendanceSchema.index({ name: 'text', phone: 'text' });

attendanceSchema.index(
    { phone: 1, date: 1, serviceType: 1 },
    { 
        unique: true,
        partialFilterExpression: { phone: { $exists: true, $ne: null } }  
    }
);

// Define models
const User = mongoose.model('User', userSchema);
const FollowUp = mongoose.model('FollowUp', followUpSchema);  
const Message = mongoose.model('Message', messageSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);


console.log('Models defined:', {
    User: !!User,
    FollowUp: !!FollowUp, 
    Message: !!Message,
    Attendance: !!Attendance
});

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',  
    credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'RCCG_TOP',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 100000 },
    store: MongoStore.create({ mongoUrl: 'mongodb://localhost:27017/followups' })
}));

// Authentication
const PREDEFINED_USER = {
    username: 'Rccg@top',
    password: bcrypt.hashSync('top2024', 10)
};

function isAuthenticated(req, res, next) {
    if (req.session.userId) return next();
    res.redirect('/login.html');
}

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === PREDEFINED_USER.username && bcrypt.compareSync(password, PREDEFINED_USER.password)) {
        req.session.userId = PREDEFINED_USER.username;
        return res.json({ success: true, message: 'Login successful' });
    }
    res.status(400).json({ success: false, message: 'Invalid credentials' });
});


app.post('/api/users', async (req, res) => {
    const { name, phone, address, email, date, comment } = req.body;
    try {
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).send({ message: 'A member with the same phone number already exists' });
        }
        const newUser = new User({ name, phone, address, email, date, comment });
        await newUser.save();
        res.status(201).send(newUser);
    } catch (error) {
        res.status(400).send(error);
    }
});


app.post('/api/followups', async (req, res) => {
    const { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber } = req.body; // Remove 'comments'

    try {
        // Check if follow-up already exists
        const existingFollowUp = await FollowUp.findOne({name});
        if (existingFollowUp) {
            return res.status(400).send({ message: 'A follow-up entry with this name already exists' });
        }

        // Create new follow-up
        const newFollowUp = new FollowUp({ 
            name, 
            status, 
            recentFollowUp, // Use recentFollowUp, not comments
            byWho, 
            dateFollowedUp,
            phoneNumber 
        });
        
        await newFollowUp.save();
        res.status(201).json(newFollowUp);
    } catch (error) {
        console.error('Error adding follow-up:', error);
        res.status(400).json({ 
            message: 'Failed to add follow-up', 
            error: error.message 
        });
    }
});

app.put('/api/followups/:id', async (req, res) => {
    console.log('=== BACKEND PUT DEBUG START ===');
    console.log('Updating ID:', req.params.id);
    console.log('Request body:', req.body);
    
    try {
        const { id } = req.params;
        const { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber } = req.body;

        // Validate required fields
        if (!name || !status || !recentFollowUp || !byWho || !dateFollowedUp || !phoneNumber) {
            console.log('Missing required fields');
            return res.status(400).json({ 
                message: 'All fields are required',
                received: { name, status, recentFollowUp, byWho, dateFollowedUp, phoneNumber }
            });
        }

        console.log('Finding document with ID:', id);
        const existingDoc = await FollowUp.findById(id);
        console.log('Existing document:', existingDoc);

        if (!existingDoc) {
            console.log('Document not found');
            return res.status(404).json({ message: 'Follow-up not found' });
        }

        console.log('Updating document...');
        const updatedFollowUp = await FollowUp.findByIdAndUpdate(
            id, 
            { 
                name, 
                status, 
                recentFollowUp, 
                byWho, 
                dateFollowedUp, 
                phoneNumber 
            }, 
            { 
                new: true,
                runValidators: true
            }
        );

        console.log('Update result:', updatedFollowUp);
        console.log('=== BACKEND PUT DEBUG END ===');
        
        res.json(updatedFollowUp);
        
    } catch (error) {
        console.error('=== BACKEND PUT ERROR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            message: 'Server error', 
            error: error.message 
        });
    }
});

app.get('/api/followups/:id', async (req, res) => {
    console.log('GET single follow-up ID:', req.params.id);
    
    try {
        const followUp = await FollowUp.findById(req.params.id);
        if (!followUp) {
            return res.status(404).json({ message: 'Follow-up not found' });
        }
        res.json(followUp);
    } catch (error) {
        console.error('Error fetching single follow-up:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.delete('/api/followups/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await FollowUp.findByIdAndDelete(id);
        res.json({ message: 'Follow-up deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/', (_req, res) => {
    res.sendFile(__dirname + '/public/message.html');  
});
app.get('/protected', isAuthenticated, (_req, res) => {
    res.send('Protected content');
});

app.get('/api/followups/stats', async (req, res) => {
    const total = await FollowUp.countDocuments();
    const regular = await FollowUp.countDocuments({ status: 'Regular' });
    res.json({ total, regular, irregular: total - regular });
});

// @route   POST /api/attendance
// @desc    Create new attendance record
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
                return res.status(400).json({ message: 'Invalid phone number format (use Ghana format: +233xxxxxxxxx or 0xxxxxxxxx)' });
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
            gender,                    // ← added
            phone: normalizedPhone,
            date,
            serviceType,
            notes: notes || ''         // ← also added notes
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

// @route   GET /api/attendance
// @desc    Get all attendance records with filters
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

// @route   GET /api/attendance/stats
// @desc    Get attendance statistics
// @route   GET /api/attendance/stats
app.get('/api/attendance/stats', async (req, res) => {
    console.log('GET /api/attendance/stats');
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Today's stats by category (existing)
        const todayCategoryStats = await Attendance.aggregate([
            {
                $match: {
                    date: { $gte: today, $lt: tomorrow }
                }
            },
            {
                $group: {
                    _id: "$category",
                    count: { $sum: 1 }
                }
            }
        ]);

        // NEW: Today's stats by gender
        const todayGenderStats = await Attendance.aggregate([
            {
                $match: {
                    date: { $gte: today, $lt: tomorrow },
                    gender: { $exists: true }  // only count records with gender
                }
            },
            {
                $group: {
                    _id: "$gender",
                    count: { $sum: 1 }
                }
            }
        ]);

        // Overall stats by category (existing)
        const overallCategoryStats = await Attendance.aggregate([
            {
                $group: {
                    _id: "$category",
                    total: { $sum: 1 },
                    lastAttendance: { $max: "$date" }
                }
            }
        ]);

        // Calculate today's total (existing)
        const todayTotal = todayCategoryStats.reduce((sum, stat) => sum + stat.count, 0);

        // NEW: Calculate male & female counts for today
        const todayMale = todayGenderStats.find(g => g._id === 'Male')?.count || 0;
        const todayFemale = todayGenderStats.find(g => g._id === 'Female')?.count || 0;

        res.json({
            today: {
                total: todayTotal,
                byCategory: todayCategoryStats.reduce((acc, stat) => {
                    acc[stat._id] = stat.count;
                    return acc;
                }, {}),
                // NEW: add gender stats
                byGender: {
                    Male: todayMale,
                    Female: todayFemale
                }
            },
            overall: {
                total: overallCategoryStats.reduce((sum, stat) => sum + stat.total, 0),
                byCategory: overallCategoryStats.reduce((acc, stat) => {
                    acc[stat._id] = {
                        total: stat.total,
                        lastAttendance: stat.lastAttendance
                    };
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Error fetching attendance stats:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/attendance/:id
// @desc    Get single attendance record
app.get('/api/attendance/:id', async (req, res) => {
    console.log('GET /api/attendance/:id - ID:', req.params.id);
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }
        res.json(attendance);
    } catch (error) {
        console.error('Error fetching single attendance:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   PUT /api/attendance/:id
// @desc    Update attendance record (check out)
app.put('/api/attendance/:id', async (req, res) => {
    console.log('PUT /api/attendance/:id - ID:', req.params.id, 'Body:', req.body);
    try {
        const { checkedOut } = req.body;
        const updateData = { ...req.body };
        
        if (checkedOut === false) {
            updateData.checkedOutTime = null;
            updateData.checkedIn = true;
        } else if (checkedOut === true) {
            updateData.checkedOutTime = new Date();
            updateData.checkedIn = false;
        }

        const attendance = await Attendance.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );
        
        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }
        
        res.json(attendance);
    } catch (error) {
        console.error('Error updating attendance:', error);
        res.status(400).json({ message: error.message });
    }
});

// @route   DELETE /api/attendance/:id
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

// @route   GET /api/attendance/search/:query
// @desc    Search attendance records
app.get('/api/attendance/search/:query', async (req, res) => {
    console.log('GET /api/attendance/search/:query - Query:', req.params.query);
    try {
        const query = req.params.query;
        const attendance = await Attendance.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { phone: { $regex: query, $options: 'i' } }
            ]
        }).sort({ date: -1 }).limit(50);
        
        res.json(attendance);
    } catch (error) {
        console.error('Error searching attendance:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/attendance/export/:type
// @desc    Export attendance data (CSV/Excel)
// @route   GET /api/attendance/export/:type
// @desc    Export attendance data (CSV/Excel)
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

app.get('/api/users', async (_req, res) => {
    try {
        const users = await User.find().sort({ _id: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/users/search', async (req, res) => {
    const { name } = req.query;
    try {
        const users = await User.find({ name: new RegExp(name, 'i') });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { comment, date } = req.body;
    try {
        const updatedUser = await User.findByIdAndUpdate(id, { comment, date }, { new: true });
        res.json(updatedUser);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await User.findByIdAndDelete(id);
        res.json({ message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.post('/send-message', async (req, res) => {
  const { name, phone } = req.body;

  // Save recipient info
  const newRecipient = new Recipient({ name, phone });
  await newRecipient.save();

  // Continue sending the message via Twilio or your logic
  res.send('Message sent and contact saved!');
});

app.post('/api/messages', async (req, res) => {
    try {
        const { name, phone, message } = req.body;
        const newMessage = new Message({ name, phone, message });
        await newMessage.save();
        res.status(201).json(newMessage);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ timestamp: -1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// In server.js
app.get('/fix-dates', async (req, res) => {
    try {
        const result = await FollowUp.updateMany(
            { dateFollowedUp: { $gt: new Date() } }, // Future dates
            [
                {
                    $set: {
                        dateFollowedUp: {
                            $dateSubtract: {
                                startDate: { $toDate: "$dateFollowedUp" },
                                unit: "year",
                                amount: 1
                            }
                        }
                    }
                }
            ]
        );

        res.json({ 
            message: `Fixed ${result.modifiedCount} future dates (2025 to 2024)` 
        });
    } catch (error) {
        console.error('Fix dates error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/send-message', async (req, res) => {
    const { name, phoneNumber, } = req.body;

    if (!name || !phoneNumber) {
        return res.status(400).json({ 
            success: false, 
            message: "Name and phone number are required" 
        });
    }

    const formattedPhone = phoneNumber.replace(/\D/g, '');

    try {
        const response = await fetch("https://e5mnxq.api.infobip.com/sms/2/text/advanced", {
            method: "POST",
            headers: {
                "Authorization": `App ${process.env.INFOBIP_API_KEY}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                "messages": [{
                    "destinations": [{ "to": formattedPhone }],
                    "from": process.env.INFOBIP_SENDER_ID || "447491163443",
                    "text": `Welcome to the RCCG Tabernacle Of Praise (Zonal) Parish, We are glad you are here. ${name}. Enjoy the service!`
                }]
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.requestError?.serviceException?.text || "Infobip API error");
        }

        res.status(200).json({ 
            success: true, 
            message: "SMS sent successfully!",
            data: result 
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Failed to send SMS",
            error: error.message 
        });
    }
});

app.get('/api/dashboard-stats', async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;

        // ── Global stats ───────────────────────────────────────────────
        // For global, we ignore date filter if no specific range is requested
        const globalMatch = {};
        if (status) globalMatch.status = { $in: status.split(',') };

        const globalStats = await FollowUp.aggregate([
            { $match: globalMatch },
            {
                $group: {
                    _id: null,
                    totalFollowUps: { $sum: 1 },
                    regular: { $sum: { $cond: [{ $eq: ["$status", "Regular"] }, 1, 0] } },
                    overdue: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $lt: ["$dateFollowedUp", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] },
                                        { $ne: ["$status", "Regular"] },
                                        { $ne: ["$dateFollowedUp", null] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    newVisitors: {
                        $sum: {
                            $cond: [
                                { $in: ["$status", ["Visitor", "First Timer"]] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        // ── Filtered user stats (apply date filter only here) ───────────────
        const userMatch = { ...globalMatch };
        if (startDate || endDate) {
            userMatch.dateFollowedUp = {};
            if (startDate) userMatch.dateFollowedUp.$gte = new Date(startDate);
            if (endDate) userMatch.dateFollowedUp.$lte = new Date(endDate);
        }

        const userStatsPipeline = [
            { $match: userMatch },
            {
                $group: {
                    _id: "$userId",
                    totalFollowUps: { $sum: 1 },
                    lastFollowUp: { $max: "$dateFollowedUp" },
                    status: { $first: "$status" },
                    phoneNumber: { $first: "$phoneNumber" }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "user"
                }
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    name: { $ifNull: ["$user.name", "Unknown"] },
                    phoneNumber: 1,
                    totalFollowUps: 1,
                    lastFollowUp: 1,
                    status: 1,
                    _id: 0
                }
            }
        ];

        const userStats = await FollowUp.aggregate(userStatsPipeline);

        res.json({
            global: globalStats[0] || { totalFollowUps: 0, regular: 0, overdue: 0, newVisitors: 0 },
            users: userStats
        });

    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ message: error.message || "Server error" });
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

// REPLACE your existing GET /api/followups with this version:
app.get('/api/followups', async (req, res) => {
    const { range = 'all', status } = req.query;
    console.log('GET /api/followups - range:', range, 'status:', status);

    try {
        // Base query: accept both string and Date
        let baseQuery = {
            $or: [
                { dateFollowedUp: { $type: "string", $regex: /^\d{4}-\d{2}-\d{2}$/ } },
                { dateFollowedUp: { $type: "date" } }
            ]
        };

        if (status) {
            const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
            if (statuses.length > 0) {
                baseQuery.status = { $in: statuses };
            }
        }

        // Fetch raw docs
        let followUps = await FollowUp.find(baseQuery).lean();

        // Normalize all dates to JS Date objects
        const now = new Date();
        const normalized = followUps.map(doc => {
            let dateObj;
            if (typeof doc.dateFollowedUp === 'string') {
                dateObj = new Date(doc.dateFollowedUp);
            } else if (doc.dateFollowedUp instanceof Date) {
                dateObj = doc.dateFollowedUp;
            } else {
                return null;
            }
            if (isNaN(dateObj)) return null;
            return { ...doc, dateObj };
        }).filter(Boolean);

        let filtered = normalized;

        // Apply time range
        if (range !== 'all') {
            let cutoff = new Date();

            if (range === '7') cutoff.setDate(now.getDate() - 7);
            else if (range === '30') cutoff.setDate(now.getDate() - 30);
            else if (range === '90') cutoff.setDate(now.getDate() - 90);
            else if (range === '365') {
                cutoff = new Date(now.getFullYear() - 1, 0, 1);
            }

            filtered = normalized.filter(f => f.dateObj >= cutoff);
        }

        // Sort newest first
        filtered.sort((a, b) => b.dateObj - a.dateObj);

        // Remove temp field
        const result = filtered.map(({ dateObj, ...rest }) => rest);

        console.log(`Returning ${result.length} follow-ups`);
        res.json(result);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.get('/api/debug-model', async (req, res) => {
    try {
        const modelInfo = {
            models: ['User', 'FollowUp', 'Message', 'Attendance'],
            FollowUp: {
                modelName: FollowUp.modelName,
                collectionName: FollowUp.collection.name
            },
            Attendance: {
                modelName: Attendance.modelName,
                collectionName: Attendance.collection.name
            }
        };
        
        res.json(modelInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Available routes:');
    console.log('  GET  /api/users');
    console.log('  GET  /api/followups');
    console.log('  GET  /api/attendance');
    console.log('  GET  /api/attendance/stats');
    console.log('  GET  /api/messages');
    console.log('  GET  /api/test');
    console.log('  GET  /api/test-db');
    console.log('  POST /api/login');
});
