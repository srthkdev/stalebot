import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { GitHubService } from "../src/lib/github";
import { getCurrentUser } from "./lib/auth_helpers";

// Repository selection and configuration functions

/**
 * Add repositories to monitoring for the current user
 */
export const addRepositoriesToMonitoring = mutation({
  args: {
    repositories: v.array(v.object({
      githubId: v.number(),
      name: v.string(),
      fullName: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    const githubService = new GitHubService();
    const addedRepositories: Id<"repositories">[] = [];

    for (const repoData of args.repositories) {
      // Validate repository access before adding
      const [owner, repo] = repoData.fullName.split("/");
      const hasAccess = await githubService.validateRepositoryAccess(
        user.accessToken,
        owner,
        repo
      );

      if (!hasAccess) {
        throw new Error(`No access to repository: ${repoData.fullName}`);
      }

      // Check if repository is already being monitored
      const existingRepo = await ctx.db
        .query("repositories")
        .withIndex("by_github_id", (q) => q.eq("githubId", repoData.githubId))
        .filter((q) => q.eq(q.field("userId"), user._id))
        .first();

      if (existingRepo) {
        // Reactivate if it was previously deactivated
        if (!existingRepo.isActive) {
          await ctx.db.patch(existingRepo._id, {
            isActive: true,
          });
          addedRepositories.push(existingRepo._id);
        }
        continue;
      }

      // Create new repository record
      const repositoryId = await ctx.db.insert("repositories", {
        userId: user._id,
        githubId: repoData.githubId,
        name: repoData.name,
        fullName: repoData.fullName,
        isActive: true,
        rules: [],
        lastChecked: 0,
        lastIssueCount: 0,
        createdAt: Date.now(),
      });

      addedRepositories.push(repositoryId);
    }

    // Update user's repository list
    const currentRepoIds = user.repositories || [];
    const newRepoIds = [...new Set([...currentRepoIds, ...addedRepositories])];

    await ctx.db.patch(user._id, {
      repositories: newRepoIds,
    });

    return addedRepositories;
  },
});

/**
 * Remove repositories from monitoring
 */
export const removeRepositoriesFromMonitoring = mutation({
  args: {
    repositoryIds: v.array(v.id("repositories")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    for (const repositoryId of args.repositoryIds) {
      // Verify user owns this repository
      const repository = await ctx.db.get(repositoryId);
      if (!repository || repository.userId !== user._id) {
        throw new Error(`Repository not found or access denied: ${repositoryId}`);
      }

      // Deactivate repository instead of deleting to preserve historical data
      await ctx.db.patch(repositoryId, {
        isActive: false,
      });

      // Deactivate all rules for this repository
      const rules = await ctx.db
        .query("rules")
        .withIndex("by_repository", (q) => q.eq("repositoryId", repositoryId))
        .collect();

      for (const rule of rules) {
        await ctx.db.patch(rule._id, {
          isActive: false,
        });
      }
    }

    // Update user's repository list
    const updatedRepoIds = user.repositories.filter(
      (id: Id<"repositories">) => !args.repositoryIds.includes(id)
    );

    await ctx.db.patch(user._id, {
      repositories: updatedRepoIds,
    });

    return { success: true };
  },
});

/**
 * Update repository settings
 */
export const updateRepositorySettings = mutation({
  args: {
    repositoryId: v.id("repositories"),
    settings: v.object({
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Verify user owns this repository
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Update repository settings
    await ctx.db.patch(args.repositoryId, args.settings);

    return { success: true };
  },
});

/**
 * Get user's monitored repositories
 */
export const getUserRepositories = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return repositories;
  },
});

/**
 * Get available GitHub repositories for the user
 */
export const getAvailableGitHubRepositories = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    const githubService = new GitHubService();

    try {
      // Fetch all accessible repositories from GitHub
      const githubRepos = await githubService.fetchAllUserRepositories(user.accessToken);

      // Get currently monitored repositories
      const monitoredRepos = await ctx.db
        .query("repositories")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

      const monitoredGithubIds = new Set(monitoredRepos.map(r => r.githubId));

      // Filter out already monitored repositories
      const availableRepos = githubRepos
        .filter(repo => !monitoredGithubIds.has(repo.id))
        .filter(repo => repo.permissions.admin || repo.permissions.push) // Only repos with write access
        .map(repo => ({
          githubId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          permissions: repo.permissions,
        }));

      return availableRepos;
    } catch (error) {
      console.error("Failed to fetch GitHub repositories:", error);
      throw new Error("Failed to fetch repositories from GitHub");
    }
  },
});

/**
 * Validate repository access for a user
 */
export const validateRepositoryAccess = mutation({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    const githubService = new GitHubService();
    const [owner, repo] = repository.fullName.split("/");

    try {
      const hasAccess = await githubService.validateRepositoryAccess(
        user.accessToken,
        owner,
        repo
      );

      if (!hasAccess) {
        // Mark repository as inactive if access is lost
        await ctx.db.patch(args.repositoryId, {
          isActive: false,
        });
      }

      return {
        hasAccess,
        repository: repository.fullName,
      };
    } catch (error) {
      console.error(`Failed to validate access for ${repository.fullName}:`, error);
      return {
        hasAccess: false,
        repository: repository.fullName,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Batch validate access for multiple repositories
 */
export const batchValidateRepositoryAccess = mutation({
  args: {
    repositoryIds: v.array(v.id("repositories")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    const results = [];
    const githubService = new GitHubService();

    for (const repositoryId of args.repositoryIds) {
      const repository = await ctx.db.get(repositoryId);
      if (!repository || repository.userId !== user._id) {
        results.push({
          repositoryId,
          hasAccess: false,
          error: "Repository not found or access denied",
        });
        continue;
      }

      const [owner, repo] = repository.fullName.split("/");

      try {
        const hasAccess = await githubService.validateRepositoryAccess(
          user.accessToken,
          owner,
          repo
        );

        if (!hasAccess) {
          // Mark repository as inactive if access is lost
          await ctx.db.patch(repositoryId, {
            isActive: false,
          });
        }

        results.push({
          repositoryId,
          repositoryName: repository.fullName,
          hasAccess,
        });
      } catch (error) {
        console.error(`Failed to validate access for ${repository.fullName}:`, error);
        results.push({
          repositoryId,
          repositoryName: repository.fullName,
          hasAccess: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});

/**
 * Get repository by GitHub ID
 */
export const getRepositoryByGitHubId = query({
  args: {
    githubId: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const repository = await ctx.db
      .query("repositories")
      .withIndex("by_github_id", (q) => q.eq("githubId", args.githubId))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .first();

    return repository;
  },
});

/**
 * Get repository with rules and statistics
 */
export const getRepositoryWithDetails = query({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      return null;
    }

    // Get rules for this repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    // Get issue statistics
    const totalIssues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    const staleIssues = totalIssues.filter(issue => issue.isStale);

    // Get recent notifications
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("repositoryId"), args.repositoryId))
      .order("desc")
      .take(5);

    return {
      ...repository,
      rules,
      statistics: {
        totalIssues: totalIssues.length,
        staleIssues: staleIssues.length,
        activeRules: rules.filter(r => r.isActive).length,
      },
      recentNotifications,
    };
  },
});

// Repository status tracking functions

/**
 * Update repository last check time and issue count
 */
export const updateRepositoryStatus = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
    lastChecked: v.number(),
    issueCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.repositoryId, {
      lastChecked: args.lastChecked,
      lastIssueCount: args.issueCount,
    });
  },
});

/**
 * Get repository health status
 */
export const getRepositoryHealthStatus = query({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      return null;
    }

    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Calculate health metrics
    const timeSinceLastCheck = now - repository.lastChecked;
    const isStale = timeSinceLastCheck > oneDay;
    const isOverdue = timeSinceLastCheck > 2 * oneDay;

    // Get recent error logs (this would be implemented with proper error tracking)
    const hasRecentErrors = false; // Placeholder - would check error logs

    // Get processing statistics
    const totalIssues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    const staleIssues = totalIssues.filter(issue => issue.isStale);

    return {
      repositoryId: args.repositoryId,
      repositoryName: repository.fullName,
      isActive: repository.isActive,
      lastChecked: repository.lastChecked,
      timeSinceLastCheck,
      isStale,
      isOverdue,
      hasRecentErrors,
      statistics: {
        totalIssues: totalIssues.length,
        staleIssues: staleIssues.length,
        lastIssueCount: repository.lastIssueCount,
        issueCountChange: totalIssues.length - repository.lastIssueCount,
      },
      healthScore: calculateHealthScore({
        isActive: repository.isActive,
        timeSinceLastCheck,
        hasRecentErrors,
        issueCount: totalIssues.length,
      }),
    };
  },
});

/**
 * Get health status for all user repositories
 */
export const getAllRepositoriesHealthStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const healthStatuses = [];

    for (const repository of repositories) {
      const now = Date.now();
      const timeSinceLastCheck = now - repository.lastChecked;
      const oneDay = 24 * 60 * 60 * 1000;

      // Get issue counts
      const totalIssues = await ctx.db
        .query("issues")
        .withIndex("by_repository", (q) => q.eq("repositoryId", repository._id))
        .collect();

      const staleIssues = totalIssues.filter(issue => issue.isStale);

      healthStatuses.push({
        repositoryId: repository._id,
        repositoryName: repository.fullName,
        isActive: repository.isActive,
        lastChecked: repository.lastChecked,
        timeSinceLastCheck,
        isStale: timeSinceLastCheck > oneDay,
        isOverdue: timeSinceLastCheck > 2 * oneDay,
        statistics: {
          totalIssues: totalIssues.length,
          staleIssues: staleIssues.length,
          lastIssueCount: repository.lastIssueCount,
          issueCountChange: totalIssues.length - repository.lastIssueCount,
        },
        healthScore: calculateHealthScore({
          isActive: repository.isActive,
          timeSinceLastCheck,
          hasRecentErrors: false, // Placeholder
          issueCount: totalIssues.length,
        }),
      });
    }

    return healthStatuses.sort((a, b) => b.healthScore - a.healthScore);
  },
});

/**
 * Manually refresh a repository
 */
export const manualRefreshRepository = mutation({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("User not authenticated");
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    if (!repository.isActive) {
      throw new Error("Cannot refresh inactive repository");
    }

    // Validate access before attempting refresh
    const githubService = new GitHubService();
    const [owner, repo] = repository.fullName.split("/");

    try {
      const hasAccess = await githubService.validateRepositoryAccess(
        user.accessToken,
        owner,
        repo
      );

      if (!hasAccess) {
        await ctx.db.patch(args.repositoryId, {
          isActive: false,
        });
        throw new Error("Access to repository has been revoked");
      }

      // Trigger manual processing by scheduling internal function
      // TODO: Implement processor:checkRepository function
      // await ctx.scheduler.runAfter(0, "processor:checkRepository", {
      //   repositoryId: args.repositoryId,
      //   isManualRefresh: true,
      // });

      return {
        success: true,
        message: "Repository refresh initiated",
        repositoryName: repository.fullName,
      };
    } catch (error) {
      console.error(`Manual refresh failed for ${repository.fullName}:`, error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to refresh repository"
      );
    }
  },
});

/**
 * Get repository processing history
 */
export const getRepositoryProcessingHistory = query({
  args: {
    repositoryId: v.id("repositories"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      return [];
    }

    // Get recent notifications as a proxy for processing history
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("repositoryId"), args.repositoryId))
      .order("desc")
      .take(args.limit || 10);

    return notifications.map(notification => ({
      timestamp: notification.sentAt,
      type: "notification_sent",
      status: notification.status,
      issueCount: notification.issueIds.length,
      emailId: notification.emailId,
    }));
  },
});

/**
 * Track repository error
 */
export const trackRepositoryError = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
    error: v.object({
      type: v.string(),
      message: v.string(),
      timestamp: v.number(),
      details: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    // In a full implementation, this would store errors in a separate collection
    // For now, we'll log the error
    console.error(`Repository error for ${args.repositoryId}:`, args.error);

    // Could implement error storage here:
    // await ctx.db.insert("repository_errors", {
    //   repositoryId: args.repositoryId,
    //   ...args.error,
    // });
  },
});

/**
 * Get repositories that need checking
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
 * Batch update repository statuses
 */
export const batchUpdateRepositoryStatuses = internalMutation({
  args: {
    updates: v.array(v.object({
      repositoryId: v.id("repositories"),
      lastChecked: v.number(),
      issueCount: v.number(),
      hasErrors: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.repositoryId, {
        lastChecked: update.lastChecked,
        lastIssueCount: update.issueCount,
      });
    }
  },
});

// Helper function to calculate repository health score
function calculateHealthScore(params: {
  isActive: boolean;
  timeSinceLastCheck: number;
  hasRecentErrors: boolean;
  issueCount: number;
}): number {
  let score = 100;

  // Deduct points for inactive repositories
  if (!params.isActive) {
    score -= 50;
  }

  // Deduct points based on time since last check
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  if (params.timeSinceLastCheck > 2 * oneDay) {
    score -= 30; // Very stale
  } else if (params.timeSinceLastCheck > oneDay) {
    score -= 15; // Stale
  } else if (params.timeSinceLastCheck > 6 * oneHour) {
    score -= 5; // Slightly behind
  }

  // Deduct points for recent errors
  if (params.hasRecentErrors) {
    score -= 20;
  }

  // Slight bonus for repositories with issues (they're being used)
  if (params.issueCount > 0) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}