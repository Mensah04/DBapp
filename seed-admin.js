import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import SystemUser from './models/SystemUser.js';

const MONGO_URI = 'mongodb://localhost:27017/followups';
const ADMIN_USERNAME = 'Topadmin';
const ADMIN_PASSWORD = 'password123'; // change after first login

async function seedAdmin() {
    try {
        await mongoose.connect(MONGO_URI);
        const existing = await SystemUser.findOne({ username: ADMIN_USERNAME });
        if (existing) {
            console.log('Admin already exists.');
            process.exit(0);
        }
        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        const admin = new SystemUser({
            username: ADMIN_USERNAME,
            passwordHash,
            role: 'admin',
            fullName: 'Super Admin'
        });
        await admin.save();
        console.log(`Admin created: ${ADMIN_USERNAME}`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seedAdmin();