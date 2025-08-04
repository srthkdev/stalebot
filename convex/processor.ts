import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GitHubService, GitHubApiError, AuthenticationError, RateLimitError } from "../src/lib/github";
import { ErrorHandler, ErrorType, ErrorSeverity, withErrorHandling, CircuitBreaker } from "./lib/errorHandling";
import { Logger } from "./lib/monitoring";
import { decryptToken } from "./lib/encryption";

// Cron job for automated repository checking
const crons = cronJobs();

crons.interval(
  "check all repositories",
  { minutes: 60 }, // Run every hour
  internal.processor.processAllRepositories
);

export default crons;

/**
 * Main processing function that iterates through all active repositories
 * This is called by the cron job and handles batch processing with error isolation
 */
export const processAllRepositories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    Logger.info("Starting scheduled repository check", { timestamp: new Date(startTime).toISOString() });

    try {
      // Get all repositories that need checking
      const repositoriesNeedingCheck = await ctx.db
        .query("repositories")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();

      if (repositoriesNeedingCheck.length === 0) {
        Logger.info("No active repositories found for checking");
        return {
          success: true,
          message: "No active repositories to check",
          processedCount: 0,
          errorCount: 0,
          duration: Date.now() - startTime,
        };
      }

      Logger.info(`Found ${repositoriesNeedingCheck.length} active repositories to check`);

      // Process repositories in batches to avoid timeouts
      const batchSize = 5; // Process 5 repositories at a time
      let processedCount = 0;
      let errorCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < repositoriesNeedingCheck.length; i += batchSize) {
        const batch = repositoriesNeedingCheck.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(repositoriesNeedingCheck.length / batchSize);
        
        Logger.info(`Processing batch ${batchNumber} of ${totalBatches}`, {
          batchSize: batch.length,
          repositoryIds: batch.map(r => r._id),
        });

        // Process batch with error isolation
        const batchResults = await Promise.allSettled(
          batch.map(repo =>
            processRepositoryInternal(ctx, {
              repositoryId: repo._id,
              isScheduledCheck: true,
            })
          )
        );

        // Track results with detailed logging
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const repository = batch[j];
          
          if (result.status === "fulfilled") {
            const repoResult = result.value;
            if (repoResult.success) {
              if ('skipped' in repoResult && repoResult.skipped) {
                skippedCount++;
                Logger.debug(`Repository skipped: ${repository.fullName}`, { 
                  reason: 'reason' in repoResult ? repoResult.reason : 'Unknown' 
                });
              } else {
                processedCount++;
                Logger.debug(`Repository processed successfully: ${repository.fullName}`, 
                  'statistics' in repoResult ? repoResult.statistics : {}
                );
              }
            } else {
              errorCount++;
              Logger.error(`Repository processing failed: ${repository.fullName}`, {
                error: repoResult.error,
                errorType: 'errorType' in repoResult ? repoResult.errorType : 'unknown',
              });
            }
          } else {
            errorCount++;
            Logger.error(`Batch processing error for ${repository.fullName}:`, result.reason);
          }
        }

        // Add small delay between batches to be respectful of rate limits
        if (i + batchSize < repositoriesNeedingCheck.length) {
          Logger.debug(`Waiting 1 second before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = Date.now() - startTime;
      const successRate = Math.round((processedCount / repositoriesNeedingCheck.length) * 100);
      
      Logger.operation("scheduled_repository_check", duration, errorCount === 0, {
        totalRepositories: repositoriesNeedingCheck.length,
        processedCount,
        errorCount,
        skippedCount,
        successRate,
      });

      return {
        success: true,
        processedCount,
        errorCount,
        skippedCount,
        totalRepositories: repositoriesNeedingCheck.length,
        successRate,
        duration,
        timestamp: startTime,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error("Critical error in processAllRepositories", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        processedCount: 0,
        errorCount: 1,
        duration,
        timestamp: startTime,
      };
    }
  },
});

/**
 * Process a single repository - fetch issues, apply rules, identify stale issues
 */
export const processRepository = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
    isScheduledCheck: v.optional(v.boolean()),
    isManualRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await processRepositoryInternal(ctx, args);
  },
});

// Circuit breaker for GitHub API calls
const githubCircuitBreaker = new CircuitBreaker(5, 60000, 300000);

/**
 * Internal function to process a single repository with enhanced error handling
 */
async function processRepositoryInternal(ctx: any, args: {
  repositoryId: Id<"repositories">;
  isScheduledCheck?: boolean;
  isManualRefresh?: boolean;
}) {
  const startTime = Date.now();
  const checkType = args.isManualRefresh ? "manual" : (args.isScheduledCheck ? "scheduled" : "unknown");

  Logger.info(`Starting ${checkType} check for repository`, { repositoryId: args.repositoryId });

  const errorContext = ErrorHandler.createContext(
    `process_repository_${checkType}`,
    undefined,
    args.repositoryId,
    { checkType }
  );

  try {
    return await withErrorHandling(async () => {
    // Get repository and user information
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${args.repositoryId} not found`);
    }

    if (!repository.isActive) {
      Logger.info(`Skipping inactive repository: ${repository.fullName}`);
      return {
        success: true,
        skipped: true,
        reason: "Repository is inactive",
        repositoryName: repository.fullName,
      };
    }

    const user = await ctx.db.get(repository.userId);
    if (!user) {
      throw new Error(`User ${repository.userId} not found for repository ${repository.fullName}`);
    }

    // Update error context with user information
    errorContext.userId = user._id;

    // Get active rules for this repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q: any) => q.eq("repositoryId", args.repositoryId))
      .filter((q: any) => q.eq(q.field("isActive"), true))
      .collect();

    if (rules.length === 0) {
      Logger.info(`No active rules found for repository: ${repository.fullName}`);
      await ctx.db.patch(args.repositoryId, {
        lastChecked: Date.now(),
      });
      return {
        success: true,
        skipped: true,
        reason: "No active rules",
        repositoryName: repository.fullName,
      };
    }

    // Initialize GitHub service
    const githubService = new GitHubService();
    const [owner, repo] = repository.fullName.split("/");

    // Decrypt access token
    const accessToken = decryptToken(user.accessToken);
    const refreshToken = user.refreshToken ? decryptToken(user.refreshToken) : "";

    // Validate repository access with circuit breaker
    const hasAccess = await githubCircuitBreaker.execute(async () => {
      return await githubService.validateRepositoryAccess(accessToken, owner, repo);
    });

    if (!hasAccess) {
      Logger.warn(`Access lost to repository: ${repository.fullName}`, { owner, repo });
      await ctx.db.patch(args.repositoryId, {
        isActive: false,
        lastChecked: Date.now(),
      });
      
      // Track repository access error
      await trackRepositoryError(ctx, args.repositoryId, {
        type: "repository_access",
        message: "Repository access has been revoked",
        timestamp: Date.now(),
        checkType,
        details: { owner, repo },
      });

      return {
        success: false,
        error: "Access to repository has been revoked",
        repositoryName: repository.fullName,
      };
    }

    // Fetch issues from GitHub with enhanced error handling and token refresh
    let issues: any[] = [];
    let tokenWasRefreshed = false;
    let newAccessToken = accessToken;

    try {
      const since = repository.lastChecked > 0 ? new Date(repository.lastChecked) : undefined;
      
      // Use circuit breaker for GitHub API calls
      const fetchResult = await githubCircuitBreaker.execute(async () => {
        if (refreshToken && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
          // Use token refresh capability if available
          const endpoint = since 
            ? `/repos/${owner}/${repo}/issues?since=${since.toISOString()}&state=all&sort=updated&direction=desc`
            : `/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc`;
          
          const result = await githubService.makeRequestWithTokenRefresh(
            endpoint,
            newAccessToken,
            refreshToken,
            process.env.GITHUB_CLIENT_ID!,
            process.env.GITHUB_CLIENT_SECRET!
          );
          
          if (result.newAccessToken) {
            newAccessToken = result.newAccessToken;
            tokenWasRefreshed = true;
          }
          
          return result.data;
        } else {
          // Fallback to regular API calls
          return since
            ? await githubService.fetchRecentRepositoryIssues(newAccessToken, owner, repo, since)
            : await githubService.fetchAllRepositoryIssues(newAccessToken, owner, repo);
        }
      });

      issues = Array.isArray(fetchResult) ? fetchResult : [];
      Logger.info(`Fetched ${issues.length} issues from ${repository.fullName}`, {
        issueCount: issues.length,
        incrementalUpdate: !!since,
        tokenRefreshed: tokenWasRefreshed,
      });

      // Update stored access token if it was refreshed
      if (tokenWasRefreshed && newAccessToken !== accessToken) {
        Logger.info(`Access token refreshed for user ${user._id}`);
        const { encryptToken } = await import("./lib/encryption");
        await ctx.db.patch(user._id, {
          accessToken: encryptToken(newAccessToken),
          lastActive: Date.now(),
        });
      }

    } catch (error) {
      // Handle specific GitHub API errors
      if (ErrorHandler.isAuthenticationExpiredError(error)) {
        Logger.error(`Authentication failed for repository ${repository.fullName}`, error);
        
        // Mark repository as needing re-authentication
        await ctx.db.patch(args.repositoryId, {
          isActive: false,
          lastChecked: Date.now(),
        });

        await trackRepositoryError(ctx, args.repositoryId, {
          type: "authentication",
          message: "GitHub authentication expired - user needs to re-authenticate",
          timestamp: Date.now(),
          checkType,
          details: { owner, repo, error: error instanceof Error ? error.message : String(error) },
        });

        return {
          success: false,
          error: "GitHub authentication expired - please re-authenticate",
          repositoryName: repository.fullName,
          requiresReauth: true,
        };
      }

      if (ErrorHandler.isRateLimitError(error)) {
        Logger.warn(`Rate limit hit for repository ${repository.fullName}`, error);
        
        await trackRepositoryError(ctx, args.repositoryId, {
          type: "rate_limit",
          message: "GitHub API rate limit exceeded",
          timestamp: Date.now(),
          checkType,
          details: { 
            owner, 
            repo, 
            resetTime: error instanceof RateLimitError ? error.resetTime : undefined,
            remaining: error instanceof RateLimitError ? error.remaining : undefined,
          },
        });

        return {
          success: false,
          error: "GitHub API rate limit exceeded - will retry later",
          repositoryName: repository.fullName,
          retryAfter: error instanceof RateLimitError ? error.resetTime : Date.now() + 60000,
        };
      }

      if (ErrorHandler.isRepositoryAccessError(error)) {
        Logger.error(`Repository access error for ${repository.fullName}`, error);
        
        // Deactivate repository
        await ctx.db.patch(args.repositoryId, {
          isActive: false,
          lastChecked: Date.now(),
        });

        await trackRepositoryError(ctx, args.repositoryId, {
          type: "repository_access",
          message: "Repository access denied or repository not found",
          timestamp: Date.now(),
          checkType,
          details: { owner, repo, error: error instanceof Error ? error.message : String(error) },
        });

        return {
          success: false,
          error: "Repository access denied or repository not found",
          repositoryName: repository.fullName,
          repositoryDeactivated: true,
        };
      }

      // Re-throw other errors to be handled by the outer error handler
      throw error;
    }

    // Update or insert issues in database
    let updatedIssueCount = 0;
    let newIssueCount = 0;

    for (const githubIssue of issues) {
      // Check if issue already exists
      const existingIssue = await ctx.db
        .query("issues")
        .withIndex("by_repository", (q: any) => q.eq("repositoryId", args.repositoryId))
        .filter((q: any) => q.eq(q.field("githubIssueId"), githubIssue.number))
        .first();

      const issueData = {
        repositoryId: args.repositoryId,
        githubIssueId: githubIssue.number,
        title: githubIssue.title,
        url: githubIssue.html_url,
        state: githubIssue.state as "open" | "closed",
        labels: githubIssue.labels.map((label: any) => label.name),
        assignee: githubIssue.assignee?.login,
        lastActivity: new Date(githubIssue.updated_at).getTime(),
        updatedAt: Date.now(),
      };

      if (existingIssue) {
        // Update existing issue
        await ctx.db.patch(existingIssue._id, issueData);
        updatedIssueCount++;
      } else {
        // Insert new issue
        await ctx.db.insert("issues", {
          ...issueData,
          isStale: false, // Will be evaluated below
          createdAt: Date.now(),
        });
        newIssueCount++;
      }
    }

    // Apply stale detection rules to all issues in the repository
    const allIssues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q: any) => q.eq("repositoryId", args.repositoryId))
      .collect();

    let staleIssueCount = 0;
    let staleStatusChanges = 0;
    const newlyStaleIssues: any[] = [];

    for (const issue of allIssues) {
      const wasStale = issue.isStale;
      const isNowStale = evaluateIssueAgainstMultipleRules(issue, rules);

      if (wasStale !== isNowStale) {
        await ctx.db.patch(issue._id, {
          isStale: isNowStale,
          updatedAt: Date.now(),
        });
        staleStatusChanges++;

        // Track newly stale issues for notification
        if (!wasStale && isNowStale) {
          newlyStaleIssues.push(issue._id);
        }
      }

      if (isNowStale) {
        staleIssueCount++;
      }
    }

    // Send notifications for newly stale issues
    if (newlyStaleIssues.length > 0) {
      console.log(`Found ${newlyStaleIssues.length} newly stale issues in ${repository.fullName}, sending notifications`);

      try {
        await ctx.scheduler.runAfter(0, internal.notifications.processStaleIssuesForNotification, {
          repositoryId: args.repositoryId,
          staleIssueIds: newlyStaleIssues,
        });
      } catch (notificationError) {
        console.error(`Failed to schedule notifications for ${repository.fullName}:`, notificationError);
        // Don't fail the entire processing if notifications fail
      }
    }

    // Update repository status
    await ctx.db.patch(args.repositoryId, {
      lastChecked: Date.now(),
      lastIssueCount: allIssues.length,
    });

    const duration = Date.now() - startTime;
    console.log(`Completed ${checkType} check for ${repository.fullName} in ${duration}ms`);

    return {
      success: true,
      repositoryName: repository.fullName,
      checkType,
      statistics: {
        totalIssues: allIssues.length,
        newIssues: newIssueCount,
        updatedIssues: updatedIssueCount,
        staleIssues: staleIssueCount,
        staleStatusChanges,
        rulesApplied: rules.length,
      },
      duration,
    };
    }, errorContext, ctx, 3); // Close the withErrorHandling call
  } catch (error) {
    const duration = Date.now() - startTime;
    Logger.error(`Error processing repository ${args.repositoryId}`, error);

    // Track the error
    await trackRepositoryError(ctx, args.repositoryId, {
      type: getErrorType(error),
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: Date.now(),
      checkType,
      details: error instanceof GitHubApiError ? {
        status: error.status,
        code: error.code,
        rateLimitRemaining: error.rateLimitRemaining,
        rateLimitReset: error.rateLimitReset,
      } : undefined,
    });

    // Update last checked time even on error to prevent constant retries
    const repository = await ctx.db.get(args.repositoryId);
    if (repository) {
      await ctx.db.patch(args.repositoryId, {
        lastChecked: Date.now(),
      });
    }

    return {
      success: false,
      repositoryName: repository?.fullName || "Unknown",
      error: error instanceof Error ? error.message : "Unknown error",
      errorType: getErrorType(error),
      duration,
      checkType,
    };
  }
}

/**
 * Get repositories that need checking based on age threshold
 */
export const getRepositoriesNeedingCheck = internalQuery({
  args: {
    maxAge: v.optional(v.number()), // milliseconds
  },
  handler: async (ctx, args) => {
    const maxAge = args.maxAge || 60 * 60 * 1000; // Default 1 hour
    const cutoffTime = Date.now() - maxAge;

    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .filter((q) => q.lt(q.field("lastChecked"), cutoffTime))
      .collect();

    return repositories;
  },
});

/**
 * Enhanced repository error tracking with comprehensive logging and monitoring
 */
async function trackRepositoryError(
  ctx: any,
  repositoryId: Id<"repositories">,
  error: {
    type: string;
    message: string;
    timestamp: number;
    checkType?: string;
    details?: any;
  }
) {
  const repository = await ctx.db.get(repositoryId);
  const repositoryName = repository?.fullName || "Unknown";

  // Create comprehensive error log
  const errorLog = {
    repositoryId,
    repositoryName,
    userId: repository?.userId,
    errorType: error.type,
    message: error.message,
    timestamp: error.timestamp,
    checkType: error.checkType || "unknown",
    details: error.details || {},
    severity: getErrorSeverity(error.type),
  };

  // Log with appropriate level based on severity
  const logLevel = errorLog.severity === "critical" ? "error" : 
                   errorLog.severity === "high" ? "error" :
                   errorLog.severity === "medium" ? "warn" : "info";

  console[logLevel](`[${errorLog.severity.toUpperCase()}] Repository error for ${repositoryName}:`, errorLog);

  // Track error patterns for monitoring
  await trackErrorPatterns(ctx, errorLog);

  // Send alerts for critical errors
  if (errorLog.severity === "critical" || errorLog.severity === "high") {
    await sendErrorAlert(ctx, errorLog);
  }

  // Store error in database for analysis (in production, this would be a separate collection)
  try {
    // For now, we'll create a simple error tracking mechanism
    // In production, this would be stored in a dedicated errors collection
    const errorRecord = {
      ...errorLog,
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      resolved: false,
      retryCount: 0,
    };

    // Log the error record for now - in production this would be stored
    console.log("Error record created:", errorRecord);
  } catch (dbError) {
    console.error("Failed to store error record:", dbError);
  }
}

/**
 * Determine error severity based on error type
 */
function getErrorSeverity(errorType: string): string {
  switch (errorType) {
    case "authentication":
      return "high";
    case "repository_access":
      return "high";
    case "rate_limit":
      return "medium";
    case "github_api":
      return "medium";
    case "database":
      return "critical";
    case "network":
      return "medium";
    default:
      return "low";
  }
}

/**
 * Track error patterns for monitoring and alerting
 */
async function trackErrorPatterns(ctx: any, errorLog: any) {
  // In production, this would analyze error patterns and trends
  // For now, we'll just log pattern information
  
  const patternInfo = {
    repositoryId: errorLog.repositoryId,
    errorType: errorLog.errorType,
    timestamp: errorLog.timestamp,
    hour: new Date(errorLog.timestamp).getHours(),
    dayOfWeek: new Date(errorLog.timestamp).getDay(),
  };

  console.log("Error pattern tracked:", patternInfo);

  // Could be extended to:
  // - Detect error spikes
  // - Identify problematic repositories
  // - Track error frequency by time of day
  // - Alert on unusual error patterns
}

/**
 * Send alerts for critical errors
 */
async function sendErrorAlert(ctx: any, errorLog: any) {
  // In production, this would send alerts via email, Slack, etc.
  console.warn(`🚨 ALERT: ${errorLog.severity.toUpperCase()} error in repository ${errorLog.repositoryName}`);
  console.warn(`Error: ${errorLog.message}`);
  console.warn(`Type: ${errorLog.errorType}`);
  console.warn(`Time: ${new Date(errorLog.timestamp).toISOString()}`);
  
  if (errorLog.details) {
    console.warn("Details:", errorLog.details);
  }

  // Could be extended to:
  // - Send email notifications to administrators
  // - Post to Slack channels
  // - Create tickets in issue tracking systems
  // - Trigger automated remediation actions
}

/**
 * Determine error type for categorization
 */
function getErrorType(error: any): string {
  if (error instanceof AuthenticationError) {
    return "authentication";
  } else if (error instanceof RateLimitError) {
    return "rate_limit";
  } else if (error instanceof GitHubApiError) {
    return "github_api";
  } else if (error.message?.includes("not found")) {
    return "not_found";
  } else if (error.message?.includes("access")) {
    return "access_denied";
  } else {
    return "unknown";
  }
}

/**
 * Enhanced rule evaluation function that handles multiple rules
 */
function evaluateIssueAgainstMultipleRules(issue: any, rules: any[]): boolean {
  // An issue is considered stale if it matches ANY of the active rules
  return rules.some(rule => evaluateIssueAgainstRule(issue, rule));
}

/**
 * Enhanced single rule evaluation with better logic
 */
function evaluateIssueAgainstRule(issue: any, rule: any): boolean {
  // Check inactivity period
  const daysSinceActivity = calculateDaysSinceActivity(issue.lastActivity);
  if (daysSinceActivity < rule.inactivityDays) {
    return false;
  }

  // Check issue state
  if (!rule.issueStates.includes(issue.state)) {
    return false;
  }

  // Check labels (if rule specifies labels, issue must have at least one matching label)
  if (rule.labels && rule.labels.length > 0) {
    const hasMatchingLabel = rule.labels.some((ruleLabel: string) =>
      issue.labels.some((issueLabel: string) =>
        issueLabel.toLowerCase() === ruleLabel.toLowerCase()
      )
    );
    if (!hasMatchingLabel) {
      return false;
    }
  }

  // Check assignee condition
  switch (rule.assigneeCondition) {
    case "any":
      // No assignee filtering
      break;
    case "assigned":
      if (!issue.assignee) {
        return false;
      }
      break;
    case "unassigned":
      if (issue.assignee) {
        return false;
      }
      break;
    default:
      // Specific users array
      if (Array.isArray(rule.assigneeCondition)) {
        if (!issue.assignee || !rule.assigneeCondition.includes(issue.assignee)) {
          return false;
        }
      }
      break;
  }

  return true;
}

/**
 * Utility function to calculate days since last activity
 */
function calculateDaysSinceActivity(lastActivity: number): number {
  return Math.floor((Date.now() - lastActivity) / (24 * 60 * 60 * 1000));
}
/**

 * Batch process repositories with proper error isolation and progress tracking
 */
export const batchProcessRepositories = internalMutation({
  args: {
    repositoryIds: v.array(v.id("repositories")),
    batchSize: v.optional(v.number()),
    delayBetweenBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const batchSize = args.batchSize || 5;
    const delayBetweenBatches = args.delayBetweenBatches || 1000; // 1 second

    console.log(`Starting batch processing of ${args.repositoryIds.length} repositories`);
    console.log(`Batch size: ${batchSize}, Delay between batches: ${delayBetweenBatches}ms`);

    const results = [];
    let processedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process repositories in batches
    for (let i = 0; i < args.repositoryIds.length; i += batchSize) {
      const batch = args.repositoryIds.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(args.repositoryIds.length / batchSize);

      console.log(`Processing batch ${batchNumber} of ${totalBatches} (${batch.length} repositories)`);

      // Process batch with error isolation
      const batchPromises = batch.map(async (repositoryId) => {
        try {
          const result = await processRepositoryInternal(ctx, {
            repositoryId,
            isScheduledCheck: false,
          });
          return { repositoryId, success: true, result };
        } catch (error) {
          console.error(`Error processing repository ${repositoryId}:`, error);
          return {
            repositoryId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      // Wait for all repositories in the batch to complete
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      for (const promiseResult of batchResults) {
        if (promiseResult.status === "fulfilled") {
          const { repositoryId, success, result, error } = promiseResult.value;

          if (success) {
            if (result && 'skipped' in result && result.skipped) {
              skippedCount++;
            } else {
              processedCount++;
            }
          } else {
            errorCount++;
          }

          results.push({
            repositoryId,
            success,
            result: result || null,
            error: error || null,
            batchNumber,
          });
        } else {
          // Promise itself failed
          errorCount++;
          results.push({
            repositoryId: "unknown",
            success: false,
            error: promiseResult.reason instanceof Error ? promiseResult.reason.message : "Promise failed",
            batchNumber,
          });
        }
      }

      // Add delay between batches (except for the last batch)
      if (i + batchSize < args.repositoryIds.length) {
        console.log(`Waiting ${delayBetweenBatches}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Batch processing completed in ${duration}ms`);
    console.log(`Processed: ${processedCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`);

    return {
      success: true,
      totalRepositories: args.repositoryIds.length,
      processedCount,
      errorCount,
      skippedCount,
      duration,
      results,
      batchConfiguration: {
        batchSize,
        delayBetweenBatches,
        totalBatches: Math.ceil(args.repositoryIds.length / batchSize),
      },
    };
  },
});

/**
 * Process repositories with progress tracking and status updates
 */
export const processRepositoriesWithProgress = internalMutation({
  args: {
    repositoryIds: v.array(v.id("repositories")),
    progressCallback: v.optional(v.string()), // Function name to call for progress updates
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const totalRepositories = args.repositoryIds.length;

    console.log(`Starting progress-tracked processing of ${totalRepositories} repositories`);

    const results = [];
    let processedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process repositories one by one with progress updates
    for (let i = 0; i < args.repositoryIds.length; i++) {
      const repositoryId = args.repositoryIds[i];
      const progress = Math.round(((i + 1) / totalRepositories) * 100);

      console.log(`Processing repository ${i + 1}/${totalRepositories} (${progress}%): ${repositoryId}`);

      try {
        // Get repository info for logging
        const repository = await ctx.db.get(repositoryId);
        const repositoryName = repository?.fullName || "Unknown";

        // Process the repository
        const result = await processRepositoryInternal(ctx, {
          repositoryId,
          isScheduledCheck: false,
        });

        if (result.success) {
          if ('skipped' in result && result.skipped) {
            skippedCount++;
            console.log(`Skipped ${repositoryName}: ${'reason' in result ? result.reason : 'Unknown'}`);
          } else {
            processedCount++;
            console.log(`Successfully processed ${repositoryName}`);
          }
        } else {
          errorCount++;
          console.error(`Failed to process ${repositoryName}: ${result.error}`);
        }

        results.push({
          repositoryId,
          repositoryName,
          success: result.success,
          result,
          progress,
        });

        // Send progress update if callback is provided
        if (args.progressCallback) {
          try {
            // In a real implementation, this would call the progress callback
            // For now, we'll just log the progress
            console.log(`Progress update: ${progress}% complete (${processedCount + errorCount + skippedCount}/${totalRepositories})`);
          } catch (callbackError) {
            console.error("Progress callback error:", callbackError);
          }
        }

      } catch (error) {
        errorCount++;
        const repository = await ctx.db.get(repositoryId);
        const repositoryName = repository?.fullName || "Unknown";

        console.error(`Critical error processing ${repositoryName}:`, error);

        results.push({
          repositoryId,
          repositoryName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          progress,
        });
      }

      // Small delay between repositories to prevent overwhelming the system
      if (i < args.repositoryIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Progress-tracked processing completed in ${duration}ms`);
    console.log(`Final results - Processed: ${processedCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`);

    return {
      success: true,
      totalRepositories,
      processedCount,
      errorCount,
      skippedCount,
      duration,
      results,
      completionRate: Math.round((processedCount / totalRepositories) * 100),
    };
  },
});

/**
 * Get processing status and statistics
 */
export const getProcessingStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Get all repositories
    const allRepositories = await ctx.db
      .query("repositories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Categorize repositories by last check time
    const categories = {
      upToDate: 0,      // Checked within last hour
      stale: 0,         // Checked 1-6 hours ago
      veryStale: 0,     // Checked 6-24 hours ago
      critical: 0,      // Not checked in over 24 hours
      neverChecked: 0,  // Never been checked
    };

    const repositoryStatuses = [];

    for (const repo of allRepositories) {
      const timeSinceCheck = now - repo.lastChecked;
      let status: string;

      if (repo.lastChecked === 0) {
        categories.neverChecked++;
        status = "never_checked";
      } else if (timeSinceCheck <= oneHour) {
        categories.upToDate++;
        status = "up_to_date";
      } else if (timeSinceCheck <= 6 * oneHour) {
        categories.stale++;
        status = "stale";
      } else if (timeSinceCheck <= oneDay) {
        categories.veryStale++;
        status = "very_stale";
      } else {
        categories.critical++;
        status = "critical";
      }

      repositoryStatuses.push({
        repositoryId: repo._id,
        repositoryName: repo.fullName,
        lastChecked: repo.lastChecked,
        timeSinceCheck,
        status,
        lastIssueCount: repo.lastIssueCount,
      });
    }

    // Get repositories that need immediate attention
    const needsAttention = repositoryStatuses.filter(repo =>
      repo.status === "critical" || repo.status === "never_checked"
    );

    return {
      totalRepositories: allRepositories.length,
      categories,
      repositoryStatuses: repositoryStatuses.sort((a, b) => a.timeSinceCheck - b.timeSinceCheck),
      needsAttention,
      systemHealth: {
        healthyPercentage: Math.round((categories.upToDate / allRepositories.length) * 100),
        criticalCount: categories.critical + categories.neverChecked,
        lastUpdateTime: now,
      },
    };
  },
});

/**
 * Retry failed repository processing with exponential backoff
 */
export const retryFailedRepositories = internalMutation({
  args: {
    repositoryIds: v.array(v.id("repositories")),
    maxRetries: v.optional(v.number()),
    baseDelay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries || 3;
    const baseDelay = args.baseDelay || 2000; // 2 seconds

    console.log(`Retrying ${args.repositoryIds.length} failed repositories with max ${maxRetries} retries`);

    const results = [];

    for (const repositoryId of args.repositoryIds) {
      const repository = await ctx.db.get(repositoryId);
      const repositoryName = repository?.fullName || "Unknown";

      console.log(`Retrying repository: ${repositoryName}`);

      let success = false;
      let lastError = null;

      // Retry with exponential backoff
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempt ${attempt}/${maxRetries} for ${repositoryName}`);

          const result = await processRepositoryInternal(ctx, {
            repositoryId,
            isScheduledCheck: false,
          });

          if (result.success) {
            success = true;
            console.log(`Successfully processed ${repositoryName} on attempt ${attempt}`);
            results.push({
              repositoryId,
              repositoryName,
              success: true,
              attemptsUsed: attempt,
              result,
            });
            break;
          } else {
            lastError = result.error;
            console.log(`Attempt ${attempt} failed for ${repositoryName}: ${result.error}`);
          }

        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
          console.error(`Attempt ${attempt} threw error for ${repositoryName}:`, error);
        }

        // Wait before next attempt (exponential backoff)
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Waiting ${delay}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      // If all retries failed
      if (!success) {
        console.error(`All retry attempts failed for ${repositoryName}`);
        results.push({
          repositoryId,
          repositoryName,
          success: false,
          attemptsUsed: maxRetries,
          error: lastError,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    console.log(`Retry operation completed. Success: ${successCount}, Failed: ${failureCount}`);

    return {
      success: true,
      totalRepositories: args.repositoryIds.length,
      successCount,
      failureCount,
      results,
      retryConfiguration: {
        maxRetries,
        baseDelay,
      },
    };
  },
});

/**
 * Health check function to verify system status
 */
export const performHealthCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();

    try {
      // Check database connectivity
      const repositoryCount = await ctx.db
        .query("repositories")
        .collect()
        .then(repos => repos.length);

      const userCount = await ctx.db
        .query("users")
        .collect()
        .then(users => users.length);

      // Check for repositories that haven't been checked recently
      const oneDay = 24 * 60 * 60 * 1000;
      const staleRepositories = await ctx.db
        .query("repositories")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .filter((q) => q.lt(q.field("lastChecked"), Date.now() - oneDay))
        .collect();

      // Check for any critical errors (this would be expanded with proper error tracking)
      const criticalErrorCount = 0; // Placeholder

      const duration = Date.now() - startTime;

      return {
        healthy: true,
        timestamp: startTime,
        duration,
        statistics: {
          totalRepositories: repositoryCount,
          totalUsers: userCount,
          staleRepositories: staleRepositories.length,
          criticalErrors: criticalErrorCount,
        },
        checks: {
          database: "healthy",
          repositories: staleRepositories.length === 0 ? "healthy" : "warning",
          errors: criticalErrorCount === 0 ? "healthy" : "critical",
        },
      };

    } catch (error) {
      return {
        healthy: false,
        timestamp: startTime,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
        checks: {
          database: "failed",
          repositories: "unknown",
          errors: "unknown",
        },
      };
    }
  },
});