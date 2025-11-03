import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
});

export default mongoose.model('Recipient', recipientSchema);

