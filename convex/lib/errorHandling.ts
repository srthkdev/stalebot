// Enhanced error handling system for StaleBot
import { GitHubApiError, AuthenticationError, RateLimitError } from "../../src/lib/github";
import { Id } from "../_generated/dataModel";

export interface ErrorContext {
  userId?: Id<"users">;
  repositoryId?: Id<"repositories">;
  operation: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface SystemError {
  id: string;
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  context: ErrorContext;
  retryable: boolean;
  retryCount?: number;
  lastRetryAt?: number;
  resolvedAt?: number;
}

export enum ErrorType {
  GITHUB_API = "github_api",
  AUTHENTICATION = "authentication",
  RATE_LIMIT = "rate_limit",
  REPOSITORY_ACCESS = "repository_access",
  DATABASE = "database",
  EMAIL_DELIVERY = "email_delivery",
  VALIDATION = "validation",
  NETWORK = "network",
  UNKNOWN = "unknown",
}

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export class ErrorHandler {
  /**
   * Categorize and handle different types of errors
   */
  static async handleError(
    error: any,
    context: ErrorContext,
    ctx?: any
  ): Promise<{
    shouldRetry: boolean;
    retryDelay?: number;
    errorInfo: SystemError;
  }> {
    const errorInfo = this.categorizeError(error, context);
    
    // Log the error
    await this.logError(errorInfo, ctx);
    
    // Determine retry strategy
    const retryStrategy = this.getRetryStrategy(errorInfo);
    
    // Track error metrics
    await this.trackErrorMetrics(errorInfo, ctx);
    
    return {
      shouldRetry: retryStrategy.shouldRetry,
      retryDelay: retryStrategy.delay,
      errorInfo,
    };
  }

  /**
   * Categorize error based on type and determine severity
   */
  private static categorizeError(error: any, context: ErrorContext): SystemError {
    let type: ErrorType;
    let severity: ErrorSeverity;
    let retryable = false;
    let message = error.message || "Unknown error";

    if (error instanceof AuthenticationError) {
      type = ErrorType.AUTHENTICATION;
      severity = ErrorSeverity.HIGH;
      retryable = false; // Auth errors need manual intervention
    } else if (error instanceof RateLimitError) {
      type = ErrorType.RATE_LIMIT;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    } else if (error instanceof GitHubApiError) {
      type = ErrorType.GITHUB_API;
      
      // Determine severity based on status code
      if (error.status === 403) {
        severity = ErrorSeverity.HIGH;
        retryable = false; // Likely permission issue
      } else if (error.status === 404) {
        severity = ErrorSeverity.MEDIUM;
        retryable = false; // Resource not found
      } else if (error.status >= 500) {
        severity = ErrorSeverity.HIGH;
        retryable = true; // Server errors are retryable
      } else {
        severity = ErrorSeverity.MEDIUM;
        retryable = error.status !== 400; // Bad requests aren't retryable
      }
    } else if (error.message?.includes("repository") && error.message?.includes("access")) {
      type = ErrorType.REPOSITORY_ACCESS;
      severity = ErrorSeverity.HIGH;
      retryable = false;
    } else if (error.message?.includes("database") || error.message?.includes("db")) {
      type = ErrorType.DATABASE;
      severity = ErrorSeverity.CRITICAL;
      retryable = true;
    } else if (error.message?.includes("email") || error.message?.includes("resend")) {
      type = ErrorType.EMAIL_DELIVERY;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    } else if (error.message?.includes("validation") || error.message?.includes("invalid")) {
      type = ErrorType.VALIDATION;
      severity = ErrorSeverity.LOW;
      retryable = false;
    } else if (error.message?.includes("network") || error.message?.includes("timeout")) {
      type = ErrorType.NETWORK;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    } else {
      type = ErrorType.UNKNOWN;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    }

    return {
      id: this.generateErrorId(),
      type,
      severity,
      message,
      context,
      retryable,
      retryCount: 0,
    };
  }

  /**
   * Determine retry strategy based on error type
   */
  private static getRetryStrategy(errorInfo: SystemError): {
    shouldRetry: boolean;
    delay?: number;
    maxRetries?: number;
  } {
    if (!errorInfo.retryable) {
      return { shouldRetry: false };
    }

    const currentRetryCount = errorInfo.retryCount || 0;
    let maxRetries = 3;
    let baseDelay = 1000; // 1 second

    switch (errorInfo.type) {
      case ErrorType.RATE_LIMIT:
        maxRetries = 5;
        baseDelay = 5000; // 5 seconds for rate limits
        break;
      case ErrorType.GITHUB_API:
        maxRetries = 3;
        baseDelay = 2000; // 2 seconds for API errors
        break;
      case ErrorType.DATABASE:
        maxRetries = 5;
        baseDelay = 500; // 500ms for database errors
        break;
      case ErrorType.EMAIL_DELIVERY:
        maxRetries = 3;
        baseDelay = 3000; // 3 seconds for email errors
        break;
      case ErrorType.NETWORK:
        maxRetries = 4;
        baseDelay = 1500; // 1.5 seconds for network errors
        break;
      default:
        maxRetries = 2;
        baseDelay = 1000;
    }

    if (currentRetryCount >= maxRetries) {
      return { shouldRetry: false };
    }

    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, currentRetryCount);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    const delay = Math.min(exponentialDelay + jitter, 60000); // Max 1 minute

    return {
      shouldRetry: true,
      delay: Math.round(delay),
      maxRetries,
    };
  }

  /**
   * Log error with appropriate detail level
   */
  private static async logError(errorInfo: SystemError, ctx?: any): Promise<void> {
    const logLevel = this.getLogLevel(errorInfo.severity);
    const logMessage = this.formatErrorMessage(errorInfo);

    // Console logging with appropriate level
    switch (logLevel) {
      case "error":
        console.error(logMessage, errorInfo);
        break;
      case "warn":
        console.warn(logMessage, errorInfo);
        break;
      case "info":
        console.info(logMessage, errorInfo);
        break;
      default:
        console.log(logMessage, errorInfo);
    }

    // Store error in database if context is available
    if (ctx && errorInfo.severity !== ErrorSeverity.LOW) {
      try {
        await this.storeErrorInDatabase(errorInfo, ctx);
      } catch (dbError) {
        console.error("Failed to store error in database:", dbError);
      }
    }
  }

  /**
   * Store error information in database for tracking and analysis
   */
  private static async storeErrorInDatabase(errorInfo: SystemError, ctx: any): Promise<void> {
    // In a full implementation, this would store in an errors collection
    // For now, we'll create a simple error tracking mechanism
    
    try {
      // This would be a proper errors collection in production
      const errorRecord = {
        errorId: errorInfo.id,
        type: errorInfo.type,
        severity: errorInfo.severity,
        message: errorInfo.message,
        operation: errorInfo.context.operation,
        userId: errorInfo.context.userId,
        repositoryId: errorInfo.context.repositoryId,
        metadata: errorInfo.context.metadata,
        timestamp: errorInfo.context.timestamp,
        retryable: errorInfo.retryable,
        retryCount: errorInfo.retryCount || 0,
      };

      // For now, we'll just log this - in production you'd insert into an errors table
      console.log("Error record for database:", errorRecord);
      
    } catch (error) {
      console.error("Failed to create error record:", error);
    }
  }

  /**
   * Track error metrics for monitoring
   */
  private static async trackErrorMetrics(errorInfo: SystemError, ctx?: any): Promise<void> {
    // In a production system, this would send metrics to monitoring service
    const metrics = {
      errorType: errorInfo.type,
      severity: errorInfo.severity,
      operation: errorInfo.context.operation,
      timestamp: errorInfo.context.timestamp,
      retryable: errorInfo.retryable,
    };

    // For now, just log metrics - in production this would go to monitoring
    console.log("Error metrics:", metrics);
  }

  /**
   * Generate unique error ID for tracking
   */
  private static generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get appropriate log level based on error severity
   */
  private static getLogLevel(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return "error";
      case ErrorSeverity.HIGH:
        return "error";
      case ErrorSeverity.MEDIUM:
        return "warn";
      case ErrorSeverity.LOW:
        return "info";
      default:
        return "log";
    }
  }

  /**
   * Format error message for logging
   */
  private static formatErrorMessage(errorInfo: SystemError): string {
    const { type, severity, message, context } = errorInfo;
    return `[${severity.toUpperCase()}] ${type}: ${message} (Operation: ${context.operation})`;
  }

  /**
   * Check if error indicates repository access has been revoked
   */
  static isRepositoryAccessError(error: any): boolean {
    if (error instanceof GitHubApiError) {
      return error.status === 404 || (error.status === 403 && error.code === "repository_access_blocked");
    }
    return error.message?.includes("repository") && error.message?.includes("access");
  }

  /**
   * Check if error indicates authentication token has expired
   */
  static isAuthenticationExpiredError(error: any): boolean {
    if (error instanceof AuthenticationError) {
      return true;
    }
    if (error instanceof GitHubApiError) {
      return error.status === 401;
    }
    return error.message?.includes("token") && error.message?.includes("expired");
  }

  /**
   * Check if error is a rate limit error
   */
  static isRateLimitError(error: any): boolean {
    return error instanceof RateLimitError || 
           (error instanceof GitHubApiError && error.status === 403 && error.rateLimitRemaining === 0);
  }

  /**
   * Get recommended action for error resolution
   */
  static getRecommendedAction(errorInfo: SystemError): string {
    switch (errorInfo.type) {
      case ErrorType.AUTHENTICATION:
        return "User needs to re-authenticate with GitHub";
      case ErrorType.RATE_LIMIT:
        return "Wait for rate limit reset and retry";
      case ErrorType.REPOSITORY_ACCESS:
        return "Repository access has been revoked - remove from monitoring";
      case ErrorType.DATABASE:
        return "Database connectivity issue - retry with backoff";
      case ErrorType.EMAIL_DELIVERY:
        return "Email service issue - retry or check configuration";
      case ErrorType.VALIDATION:
        return "Fix validation errors in input data";
      case ErrorType.NETWORK:
        return "Network connectivity issue - retry with backoff";
      default:
        return "Review error details and retry if appropriate";
    }
  }

  /**
   * Create error context for operations
   */
  static createContext(
    operation: string,
    userId?: Id<"users">,
    repositoryId?: Id<"repositories">,
    metadata?: Record<string, any>
  ): ErrorContext {
    return {
      userId,
      repositoryId,
      operation,
      timestamp: Date.now(),
      metadata,
    };
  }
}

/**
 * Wrapper function for operations that need error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  ctx?: any,
  maxRetries = 3
): Promise<T> {
  let lastError: any;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      const errorResult = await ErrorHandler.handleError(error, {
        ...context,
        metadata: { ...context.metadata, retryCount },
      }, ctx);

      if (!errorResult.shouldRetry || retryCount >= maxRetries) {
        throw error;
      }

      // Wait before retrying
      if (errorResult.retryDelay) {
        await new Promise(resolve => setTimeout(resolve, errorResult.retryDelay));
      }

      retryCount++;
    }
  }

  throw lastError;
}

/**
 * Circuit breaker pattern for external service calls
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly failureThreshold = 5,
    private readonly recoveryTimeout = 60000, // 1 minute
    private readonly monitoringWindow = 300000 // 5 minutes
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open - service unavailable");
      }
    }

    try {
      const result = await operation();
      
      if (this.state === "half-open") {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.lastFailureTime = 0;
  }

  getState(): { state: string; failures: number; lastFailureTime: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}