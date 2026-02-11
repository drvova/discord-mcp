import { Logger } from "./Logger.js";

class DiscordAPIError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly method?: string,
    public readonly path?: string
  ) {
    super(message);
    this.name = 'DiscordAPIError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number,
    public readonly global: boolean
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

const logger = Logger.getInstance().child("error-handler");

export class ErrorHandler {
  static handle(error: any): never {
    logger.error("Discord MCP Error", error);
    
    // Re-throw specific error types
    if (error instanceof DiscordAPIError) {
      throw error;
    }
    
    if (error instanceof ValidationError) {
      throw error;
    }
    
    if (error instanceof PermissionError) {
      throw error;
    }
    
    if (error instanceof RateLimitError) {
      throw error;
    }
    
    // Handle Discord.js errors
    if (error.name === 'DiscordAPIError') {
      throw new DiscordAPIError(
        error.message,
        error.code,
        error.method,
        error.path
      );
    }
    
    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      throw new ValidationError(`Validation failed: ${error.message}`);
    }
    
    // Handle generic errors
    if (error instanceof Error) {
      throw new Error(`Operation failed: ${error.message}`);
    }
    
    // Handle unknown errors
    throw new Error(`Unknown error occurred: ${String(error)}`);
  }
}
