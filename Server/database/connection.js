const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    //mongodb connection string
    const con = await mongoose.connect('mongodb+srv://ashwanix2749:2749@cluster0.3x8suve.mongodb.net/');
    console.log(`MongoDB connected: ${con.connection.host}`);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};
module.exports = connectDB;
