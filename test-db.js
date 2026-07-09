import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI_TEST_DB || 'mongodb+srv://joemensah708_db_user:50InyShGGooS1wRQ@cluster0.c4pambf.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connection successful!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });