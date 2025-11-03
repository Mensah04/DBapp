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
    phoneNumber: String
});  // No collection override

const messageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    message: String,
    timestamp: { type: Date, default: Date.now }
});

// Define models
const User = mongoose.model('User', userSchema);
const FollowUp = mongoose.model('FollowUp', followUpSchema);  // ← FIXED
const Message = mongoose.model('Message', messageSchema);

console.log('Models defined:', {
    User: !!User,
    FollowUp: !!FollowUp, 
    Message: !!Message
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
        // Get optional query parameters
        const { startDate, endDate, status } = req.query;
        
        // Build match stage conditionally
        const matchStage = {};
        if (startDate || endDate) {
            matchStage.dateFollowedUp = {};
            if (startDate) matchStage.dateFollowedUp.$gte = new Date(startDate);
            if (endDate) matchStage.dateFollowedUp.$lte = new Date(endDate);
        }
        if (status) matchStage.status = status;

        const pipeline = [
            // Add match stage if filters exist
            ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
            
            {
                $group: {
                    _id: "$userId",
                    totalFollowUps: { $sum: 1 },
                    lastFollowUp: { $max: "$dateFollowedUp" }
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
            { $unwind: "$user" },
            { 
                $project: { 
                    name: "$user.name", 
                    totalFollowUps: 1, 
                    lastFollowUp: 1,
                    _id: 0  
                } 
            }
        ];

        const stats = await FollowUp.aggregate(pipeline);
        res.json(stats);
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ message: "Server error" });
    }
});

app.get('/fix-followups', async (req, res) => {
    try {
        const result = await FollowUp.updateMany(
            { phoneNumber: { $exists: false } },
            { $set: { phoneNumber: 'Not provided' } }
        );
        res.json({ message: `Updated ${result.modifiedCount} documents` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug-model', async (req, res) => {
    try {
        const modelInfo = {
            modelName: FollowUp.modelName,
            collectionName: FollowUp.collection.name,
            collectionDbName: FollowUp.collection.dbName,
            collectionNamespace: FollowUp.collection.namespace
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

const port = 3000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
