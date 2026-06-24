import mongoose from 'mongoose';
const systemUserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['viewer', 'secretary', 'admin'], default: 'viewer' }
});
export default mongoose.model('SystemUser', systemUserSchema);