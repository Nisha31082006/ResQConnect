import mongoose from 'mongoose';
import { env } from './env';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string = env.mongoUri): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    return conn;
  } catch (err) {
    const message = (err as Error).message;
    throw new Error(
      `Could not connect to MongoDB (${message}). ` +
        'Check MONGODB_URI in .env, and make sure MongoDB is running (local service) or your Atlas IP allow-list includes your address.',
    );
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
