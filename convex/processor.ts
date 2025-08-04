import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GitHubService, GitHubApiError, AuthenticationError, RateLimitError } from "../src/lib/github";

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
    console.log("Starting scheduled repository check at", new Date(startTime).toISOString());

    try {
      // Get all repositories that need checking
      const repositoriesNeedingCheck = await ctx.db
        .query("repositories")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();

      if (repositoriesNeedingCheck.length === 0) {
        console.log("No active repositories found for checking");
        return {
          success: true,
          message: "No active repositories to check",
          processedCount: 0,
          errorCount: 0,
          duration: Date.now() - startTime,
        };
      }

      console.log(`Found ${repositoriesNeedingCheck.length} active repositories to check`);

      // Process repositories in batches to avoid timeouts
      const batchSize = 5; // Process 5 repositories at a time
      const results = [];
      let processedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < repositoriesNeedingCheck.length; i += batchSize) {
        const batch = repositoriesNeedingCheck.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(repositoriesNeedingCheck.length / batchSize)}`);

        // Process batch with error isolation
        const batchResults = await Promise.allSettled(
          batch.map(repo =>
            processRepositoryInternal(ctx, {
              repositoryId: repo._id,
              isScheduledCheck: true,
            })
          )
        );

        // Track results
        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            processedCount++;
          } else {
            errorCount++;
            console.error("Batch processing error:", result.reason);
          }
        }

        // Add small delay between batches to be respectful of rate limits
        if (i + batchSize < repositoriesNeedingCheck.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = Date.now() - startTime;
      console.log(`Completed scheduled check in ${duration}ms. Processed: ${processedCount}, Errors: ${errorCount}`);

      return {
        success: true,
        processedCount,
        errorCount,
        totalRepositories: repositoriesNeedingCheck.length,
        duration,
        timestamp: startTime,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error("Critical error in processAllRepositories:", error);

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

/**
 * Internal function to process a single repository
 */
async function processRepositoryInternal(ctx: any, args: {
  repositoryId: Id<"repositories">;
  isScheduledCheck?: boolean;
  isManualRefresh?: boolean;
}) {
  const startTime = Date.now();
  const checkType = args.isManualRefresh ? "manual" : (args.isScheduledCheck ? "scheduled" : "unknown");

  console.log(`Starting ${checkType} check for repository ${args.repositoryId}`);

  try {
    // Get repository and user information
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${args.repositoryId} not found`);
    }

    if (!repository.isActive) {
      console.log(`Skipping inactive repository: ${repository.fullName}`);
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

    // Get active rules for this repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q: any) => q.eq("repositoryId", args.repositoryId))
      .filter((q: any) => q.eq(q.field("isActive"), true))
      .collect();

    if (rules.length === 0) {
      console.log(`No active rules found for repository: ${repository.fullName}`);
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

    // Validate repository access
    const hasAccess = await githubService.validateRepositoryAccess(
      user.accessToken,
      owner,
      repo
    );

    if (!hasAccess) {
      console.log(`Access lost to repository: ${repository.fullName}`);
      await ctx.db.patch(args.repositoryId, {
        isActive: false,
        lastChecked: Date.now(),
      });
      return {
        success: false,
        error: "Access to repository has been revoked",
        repositoryName: repository.fullName,
      };
    }

    // Fetch issues from GitHub (incremental update if we have a last check time)
    const since = repository.lastChecked > 0 ? new Date(repository.lastChecked) : undefined;
    const issues = since
      ? await githubService.fetchRecentRepositoryIssues(user.accessToken, owner, repo, since)
      : await githubService.fetchAllRepositoryIssues(user.accessToken, owner, repo);

    console.log(`Fetched ${issues.length} issues from ${repository.fullName}`);

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

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Error processing repository ${args.repositoryId}:`, error);

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
 * Track repository processing errors
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
  // Log the error
  console.error(`Repository error for ${repositoryId}:`, error);

  // In a full implementation, this would store errors in a separate collection
  // For now, we'll just log it. Could be extended to:
  // - Store in a repository_errors collection
  // - Send alerts for critical errors
  // - Track error patterns for monitoring
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
            if (result?.skipped) {
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
          if (result.skipped) {
            skippedCount++;
            console.log(`Skipped ${repositoryName}: ${result.reason}`);
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