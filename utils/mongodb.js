import { MongoClient } from "mongodb";
import { config } from "dotenv";
config();

let mongoClient;
let db;

export const connectDB = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await mongoClient.connect();
    db = mongoClient.db("SquadJS");
    console.log("Connected to MongoDB");
  }
  return db;
};

export const getCollection = async (collectionName) => {
  if (!db) await connectDB();
  return db.collection(collectionName);
};

export const closeDB = async () => {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
    console.log("Disconnected from MongoDB");
  }
};
