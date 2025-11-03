const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://Mensah04:Josef2024@cluster0.fat7n.mongodb.net/followups?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB connection successful');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});