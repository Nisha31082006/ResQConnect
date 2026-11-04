import { z } from 'zod';
import { optionalPhone, strList, text } from './common';

export const passwordRule = z
  .string({ required_error: 'required' })
  .min(8, 'password_too_short')
  .max(128, 'too_long')
  .regex(/[A-Za-z]/, 'password_needs_letter')
  .regex(/[0-9]/, 'password_needs_digit');

export const SELF_REGISTER_ROLES = ['citizen', 'volunteer', 'food_provider', 'shelter_coordinator'] as const;

export const registerSchema = z.object({
  name: text(2, 120),
  email: z.string({ required_error: 'required' }).trim().toLowerCase().email('invalid_email').max(200, 'too_long'),
  password: passwordRule,
  phone: optionalPhone,
  role: z.enum(SELF_REGISTER_ROLES, { errorMap: () => ({ message: 'invalid_role' }) }).default('citizen'),
  preferredLanguage: z.enum(['en', 'ta']).default('en'),
  skills: strList().optional(),
});

export const loginSchema = z.object({
  email: z.string({ required_error: 'required' }).trim().toLowerCase().email('invalid_email'),
  password: z.string({ required_error: 'required' }).min(1, 'required'),
});

export const updateProfileSchema = z
  .object({
    name: text(2, 120).optional(),
    phone: optionalPhone,
    preferredLanguage: z.enum(['en', 'ta']).optional(),
    skills: strList().optional(),
    availability: z.enum(['available', 'busy', 'unavailable']).optional(),
  })
  .strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'required' }).min(1, 'required'),
  newPassword: passwordRule,
});
