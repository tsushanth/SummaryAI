/**
 * Authentication middleware
 * Verifies JWT tokens from Supabase Auth
 */

import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import type { AuthenticatedUser, ErrorResponse } from '../types/api.js';

/**
 * Extracts the Bearer token from Authorization header
 */
function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Authentication middleware
 * Verifies the JWT token and attaches user info to the request
 */
export async function authenticate(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req.headers.authorization);

  // Log auth attempt for debugging
  console.log(`[Auth] ${req.method} ${req.path} - Token present: ${!!token}, Auth header: ${req.headers.authorization?.substring(0, 30)}...`);

  if (!token) {
    console.log('[Auth] No token found in authorization header');
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      },
    });
    return;
  }

  try {
    // Create a Supabase client with the user's token
    const supabase = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Verify the token by getting the user
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      console.log(`[Auth] Token validation failed - Error: ${error?.message}, User: ${!!user}`);
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        },
      });
      return;
    }

    console.log(`[Auth] Authenticated user: ${user.id}`);

    // Attach user to request
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email || '',
      role: user.role || 'authenticated',
    };

    req.user = authenticatedUser;
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    res.status(401).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
      },
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is present, but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    next();
    return;
  }

  try {
    const supabase = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      req.user = {
        id: user.id,
        email: user.email || '',
        role: user.role || 'authenticated',
      };
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
}

/**
 * Require specific role middleware
 * Must be used after authenticate middleware
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response<ErrorResponse>, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Internal authentication middleware
 * Verifies internal service-to-service calls using a shared secret
 * Used for Cloud Tasks callbacks and other internal services
 */
export function internalAuth(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction
): void {
  const internalSecret = config.INTERNAL_SECRET;

  // Skip verification if no secret is configured (development)
  if (!internalSecret) {
    console.warn('[Internal Auth] INTERNAL_SECRET not set, skipping verification');
    next();
    return;
  }

  const providedSecret = req.headers['x-internal-secret'] as string | undefined;

  if (!providedSecret) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing internal secret header',
      },
    });
    return;
  }

  if (providedSecret !== internalSecret) {
    res.status(401).json({
      error: {
        code: 'INVALID_SECRET',
        message: 'Invalid internal secret',
      },
    });
    return;
  }

  next();
}
