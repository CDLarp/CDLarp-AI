'use server';

import { z } from 'zod';
import { createUser, getUser } from '@/lib/db/queries';
import { signIn } from './auth';

// Enhanced validation schema with better error messages
const authFormSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Common auth states
type AuthStatus = 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';

export interface LoginActionState {
  status: AuthStatus;
  error?: string;
}

export interface RegisterActionState {
  status: AuthStatus | 'user_exists';
  error?: string;
}

const handleAuthError = (error: unknown): LoginActionState => {
  if (error instanceof z.ZodError) {
    return { 
      status: 'invalid_data', 
      error: error.errors[0].message 
    };
  }
  
  return { 
    status: 'failed',
    error: 'Authentication failed. Please try again.'
  };
};

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    await signIn('credentials', {
      ...validatedData,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    return handleAuthError(error);
  }
};

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    const [existingUser] = await getUser(validatedData.email);

    if (existingUser) {
      return { 
        status: 'user_exists',
        error: 'An account with this email already exists'
      };
    }

    await createUser(validatedData.email, validatedData.password);
    
    await signIn('credentials', {
      ...validatedData,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    return handleAuthError(error);
  }
};