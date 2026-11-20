import mongoose, { Schema, Document } from 'mongoose';

export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash?: string;
  displayName: string;
  avatarUrl?: string;
  googleId?: string;
  authProvider: 'local' | 'google';
  role: 'user' | 'admin';
  preferences: {
    theme: 'dark' | 'light';
    defaultModel: string;
    defaultMode: 'inline' | 'async' | 'basic' | 'bypass';
  };
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = Document & IUser;

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: false, // Optional for pure Google OAuth users
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    avatarUrl: {
      type: String,
      trim: true,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    preferences: {
      theme: {
        type: String,
        enum: ['dark', 'light'],
        default: 'dark',
      },
      defaultModel: {
        type: String,
        default: 'gemini-1.5-flash',
      },
      defaultMode: {
        type: String,
        enum: ['inline', 'async', 'basic', 'bypass'],
        default: 'inline',
      },
    },
    passwordResetToken: {
      type: String,
      index: true,
    },
    passwordResetExpires: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUser>('User', UserSchema);
