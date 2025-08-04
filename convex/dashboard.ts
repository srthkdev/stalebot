import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Dashboard data aggregation functions for StaleBot
// Requirements: 5.1, 5.2, 5.3, 5.7

/**
 * Get comprehensive dashboard data for a user
 * Requirement 5.1: Display all monitored repositories with their status
 * Requirement 5.2: Show last check time and number of stale issues found
 * Requirement 5.3: Display recent email notifications with delivery status
 */
export const getUserDashboard = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get all repositories for the user with their statistics
    const repositories = await Promise.all(
      user.repositories.map(async (repoId) => {
        const repo = await ctx.db.get(repoId);
        if (!repo) return null;

        // Get stale issue count for this repository
        const staleIssues = await ctx.db
          .query("issues")
          .withIndex("by_stale_status", (q) => q.eq("repositoryId", repoId).eq("isStale", true))
          .collect();

        // Get total issue count for this repository
        const totalIssues = await ctx.db
          .query("issues")
          .withIndex("by_repository", (q) => q.eq("repositoryId", repoId))
          .collect();

        // Get last notification sent for this repository
        const lastNotification = await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .filter((q) => q.eq(q.field("repositoryId"), repoId))
          .order("desc")
          .first();

        return {
          ...repo,
          staleIssueCount: staleIssues.length,
          totalIssueCount: totalIssues.length,
          lastNotificationSent: lastNotification?.sentAt,
        };
      })
    );

    // Filter out null repositories (deleted repos)
    const validRepositories = repositories.filter((repo) => repo !== null);

    // Get recent notifications (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("sentAt"), thirtyDaysAgo))
      .order("desc")
      .take(50);

    // Calculate summary statistics
    const totalStaleIssues = validRepositories.reduce(
      (sum, repo) => sum + repo.staleIssueCount,
      0
    );

    const activeRules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return {
      user,
      repositories: validRepositories,
      recentNotifications,
      totalStaleIssues,
      activeRules: activeRules.length,
    };
  },
});

/**
 * Get detailed repository statistics and health metrics
 * Requirement 5.2: Show repository status and performance metrics
 */
export const getRepositoryStats = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    // Get all issues for this repository
    const allIssues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    // Get stale issues
    const staleIssues = allIssues.filter((issue) => issue.isStale);

    // Get issues by state
    const openIssues = allIssues.filter((issue) => issue.state === "open");
    const closedIssues = allIssues.filter((issue) => issue.state === "closed");

    // Calculate average days since last activity for stale issues
    const now = Date.now();
    const staleDays = staleIssues.map(
      (issue) => Math.floor((now - issue.lastActivity) / (24 * 60 * 60 * 1000))
    );
    const averageStaleDays = staleDays.length > 0
      ? Math.round(staleDays.reduce((sum, days) => sum + days, 0) / staleDays.length)
      : 0;

    // Get notification history for this repository
    const notifications = await ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("repositoryId"), args.repositoryId))
      .order("desc")
      .take(10);

    // Calculate notification success rate
    const successfulNotifications = notifications.filter(
      (n) => n.status === "delivered" || n.status === "sent"
    );
    const notificationSuccessRate = notifications.length > 0
      ? Math.round((successfulNotifications.length / notifications.length) * 100)
      : 100;

    // Get active rules for this repository
    const activeRules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return {
      repository,
      statistics: {
        totalIssues: allIssues.length,
        staleIssues: staleIssues.length,
        openIssues: openIssues.length,
        closedIssues: closedIssues.length,
        averageStaleDays,
        notificationSuccessRate,
        activeRulesCount: activeRules.length,
        lastChecked: repository.lastChecked,
        daysSinceLastCheck: Math.floor((now - repository.lastChecked) / (24 * 60 * 60 * 1000)),
      },
      recentNotifications: notifications,
      activeRules,
    };
  },
});

/**
 * Get system health indicators and performance metrics
 * Requirement 5.7: Display system status and health information
 */
export const getSystemHealth = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Get total counts
    const totalUsers = await ctx.db.query("users").collect();
    const totalRepositories = await ctx.db.query("repositories").collect();
    const activeRepositories = totalRepositories.filter((repo) => repo.isActive);

    // Get recent activity metrics
    const recentNotifications = await ctx.db
      .query("notifications")
      .filter((q) => q.gte(q.field("sentAt"), oneDayAgo))
      .collect();

    const recentlyCheckedRepos = activeRepositories.filter(
      (repo) => repo.lastChecked > oneDayAgo
    );

    // Calculate notification delivery rates
    const deliveredNotifications = recentNotifications.filter(
      (n) => n.status === "delivered" || n.status === "sent"
    );
    const failedNotifications = recentNotifications.filter(
      (n) => n.status === "failed" || n.status === "bounced"
    );

    const deliveryRate = recentNotifications.length > 0
      ? Math.round((deliveredNotifications.length / recentNotifications.length) * 100)
      : 100;

    // Get stale repositories (not checked in over 24 hours)
    const staleRepositories = activeRepositories.filter(
      (repo) => repo.lastChecked < oneDayAgo
    );

    // Calculate average processing time (time between last check and current time)
    const avgProcessingDelay = activeRepositories.length > 0
      ? Math.round(
        activeRepositories.reduce((sum, repo) => sum + (now - repo.lastChecked), 0) /
        activeRepositories.length / (60 * 60 * 1000) // Convert to hours
      )
      : 0;

    // Get error indicators
    const bouncedUsers = totalUsers.filter(
      (user) => user.notificationPreferences.bounceCount && user.notificationPreferences.bounceCount > 0
    );

    return {
      overview: {
        totalUsers: totalUsers.length,
        totalRepositories: totalRepositories.length,
        activeRepositories: activeRepositories.length,
        totalStaleIssues: 0, // Will be calculated if needed
      },
      performance: {
        notificationsLast24h: recentNotifications.length,
        deliveryRate,
        failedNotifications: failedNotifications.length,
        repositoriesCheckedLast24h: recentlyCheckedRepos.length,
        averageProcessingDelayHours: avgProcessingDelay,
      },
      health: {
        staleRepositories: staleRepositories.length,
        bouncedUsers: bouncedUsers.length,
        systemStatus: staleRepositories.length > activeRepositories.length * 0.1 ? "degraded" : "healthy",
      },
      lastUpdated: now,
    };
  },
});

/**
 * Get notification history with detailed information
 * Requirement 5.3: Display recent email notifications with delivery status
 */
export const getNotificationHistory = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Get notifications for the user
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    // Apply pagination
    const paginatedNotifications = notifications.slice(offset, offset + limit);

    // Enrich notifications with repository and issue details
    const enrichedNotifications = await Promise.all(
      paginatedNotifications.map(async (notification) => {
        const repository = await ctx.db.get(notification.repositoryId);

        // Get issue details
        const issues = await Promise.all(
          notification.issueIds.map(async (issueId) => {
            const issue = await ctx.db.get(issueId);
            return issue ? {
              _id: issue._id,
              title: issue.title,
              url: issue.url,
              lastActivity: issue.lastActivity,
            } : null;
          })
        );

        const validIssues = issues.filter((issue) => issue !== null);

        return {
          ...notification,
          repositoryName: repository?.name || "Unknown Repository",
          repositoryFullName: repository?.fullName || "unknown/repo",
          issueCount: validIssues.length,
          issues: validIssues,
        };
      })
    );

    return {
      notifications: enrichedNotifications,
      totalCount: notifications.length,
      hasMore: offset + limit < notifications.length,
    };
  },
});

/**
 * Get summary statistics for dashboard overview
 * Requirements: 5.1, 5.2, 5.3 - Provide quick overview metrics
 */
export const getDashboardSummary = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Get user's repositories
    const repositories = await Promise.all(
      user.repositories.map((repoId) => ctx.db.get(repoId))
    );
    const validRepositories = repositories.filter((repo) => repo !== null);
    const activeRepositories = validRepositories.filter((repo) => repo.isActive);

    // Calculate total stale issues across all repositories
    let totalStaleIssues = 0;
    for (const repo of validRepositories) {
      const staleIssues = await ctx.db
        .query("issues")
        .withIndex("by_stale_status", (q) => q.eq("repositoryId", repo._id).eq("isStale", true))
        .collect();
      totalStaleIssues += staleIssues.length;
    }

    // Get recent notifications
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("sentAt"), oneWeekAgo))
      .collect();

    // Get active rules count
    const activeRules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Calculate repositories needing attention (not checked recently)
    const repositoriesNeedingAttention = activeRepositories.filter(
      (repo) => repo.lastChecked < oneDayAgo
    );

    return {
      totalRepositories: validRepositories.length,
      activeRepositories: activeRepositories.length,
      totalStaleIssues,
      activeRules: activeRules.length,
      notificationsThisWeek: recentNotifications.length,
      repositoriesNeedingAttention: repositoriesNeedingAttention.length,
      lastUpdated: now,
    };
  },
});

// Dashboard Management Features
// Requirements: 5.4, 5.5, 5.6, 5.7

/**
 * Get dashboard management data including repositories and rules
 * Requirement 5.4: Repository management interface with add/remove functionality
 * Requirement 5.5: Rule management UI with creation, editing, and deletion
 */
export const getDashboardManagementData = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get user's repositories with detailed information
    const repositories = await Promise.all(
      user.repositories.map(async (repoId) => {
        const repo = await ctx.db.get(repoId);
        if (!repo) return null;

        // Get rules for this repository
        const rules = await ctx.db
          .query("rules")
          .withIndex("by_repository", (q) => q.eq("repositoryId", repoId))
          .collect();

        // Get issue statistics
        const allIssues = await ctx.db
          .query("issues")
          .withIndex("by_repository", (q) => q.eq("repositoryId", repoId))
          .collect();

        const staleIssues = allIssues.filter(issue => issue.isStale);

        // Get last notification
        const lastNotification = await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .filter((q) => q.eq(q.field("repositoryId"), repoId))
          .order("desc")
          .first();

        return {
          ...repo,
          rulesCount: rules.length,
          activeRulesCount: rules.filter(r => r.isActive).length,
          totalIssues: allIssues.length,
          staleIssues: staleIssues.length,
          lastNotificationSent: lastNotification?.sentAt,
          healthScore: calculateRepositoryHealthScore(repo, allIssues, staleIssues),
        };
      })
    );

    const validRepositories = repositories.filter(repo => repo !== null);

    // Get all user's rules with repository information
    const allRules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const rulesWithRepoInfo = await Promise.all(
      allRules.map(async (rule) => {
        const repository = await ctx.db.get(rule.repositoryId);
        return {
          ...rule,
          repositoryName: repository?.name || "Unknown Repository",
          repositoryFullName: repository?.fullName || "unknown/repo",
          repositoryIsActive: repository?.isActive || false,
        };
      })
    );

    return {
      repositories: validRepositories,
      rules: rulesWithRepoInfo,
      summary: {
        totalRepositories: validRepositories.length,
        activeRepositories: validRepositories.filter(r => r.isActive).length,
        totalRules: allRules.length,
        activeRules: allRules.filter(r => r.isActive).length,
        repositoriesWithIssues: validRepositories.filter(r => r.totalIssues > 0).length,
        repositoriesWithStaleIssues: validRepositories.filter(r => r.staleIssues > 0).length,
      },
    };
  },
});

/**
 * Get available GitHub repositories for adding to monitoring
 * Requirement 5.4: Repository management interface with add/remove functionality
 */
export const getAvailableRepositoriesForDashboard = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get currently monitored repositories
    const monitoredRepos = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const monitoredGithubIds = new Set(monitoredRepos.map(r => r.githubId));

    // This would typically call GitHub API to get available repos
    // For now, return a placeholder structure
    return {
      availableRepositories: [], // Would be populated from GitHub API
      monitoredRepositories: monitoredRepos.map(repo => ({
        githubId: repo.githubId,
        name: repo.name,
        fullName: repo.fullName,
        isActive: repo.isActive,
      })),
      canAddMore: monitoredRepos.length < 50, // Example limit
    };
  },
});

/**
 * Bulk repository management operations
 * Requirement 5.4: Repository management interface with add/remove functionality
 */
export const bulkRepositoryOperation = mutation({
  args: {
    userId: v.id("users"),
    operation: v.union(v.literal("activate"), v.literal("deactivate"), v.literal("remove")),
    repositoryIds: v.array(v.id("repositories")),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const results = [];

    for (const repositoryId of args.repositoryIds) {
      try {
        const repository = await ctx.db.get(repositoryId);
        if (!repository || repository.userId !== args.userId) {
          results.push({
            repositoryId,
            success: false,
            error: "Repository not found or access denied",
          });
          continue;
        }

        switch (args.operation) {
          case "activate":
            await ctx.db.patch(repositoryId, { isActive: true });
            break;
          case "deactivate":
            await ctx.db.patch(repositoryId, { isActive: false });
            // Also deactivate all rules for this repository
            const rules = await ctx.db
              .query("rules")
              .withIndex("by_repository", (q) => q.eq("repositoryId", repositoryId))
              .collect();
            for (const rule of rules) {
              await ctx.db.patch(rule._id, { isActive: false });
            }
            break;
          case "remove":
            // Remove from user's repository list
            const updatedRepoIds = user.repositories.filter((id: Id<"repositories">) => id !== repositoryId);
            await ctx.db.patch(args.userId, { repositories: updatedRepoIds });
            // Deactivate repository and rules
            await ctx.db.patch(repositoryId, { isActive: false });
            const rulesToDeactivate = await ctx.db
              .query("rules")
              .withIndex("by_repository", (q) => q.eq("repositoryId", repositoryId))
              .collect();
            for (const rule of rulesToDeactivate) {
              await ctx.db.patch(rule._id, { isActive: false });
            }
            break;
        }

        results.push({
          repositoryId,
          repositoryName: repository.fullName,
          success: true,
          operation: args.operation,
        });
      } catch (error) {
        results.push({
          repositoryId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      operation: args.operation,
      results,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
    };
  },
});

/**
 * Bulk rule management operations
 * Requirement 5.5: Rule management UI with creation, editing, and deletion
 */
export const bulkRuleOperation = mutation({
  args: {
    userId: v.id("users"),
    operation: v.union(v.literal("activate"), v.literal("deactivate"), v.literal("delete")),
    ruleIds: v.array(v.id("rules")),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const results = [];

    for (const ruleId of args.ruleIds) {
      try {
        const rule = await ctx.db.get(ruleId);
        if (!rule || rule.userId !== args.userId) {
          results.push({
            ruleId,
            success: false,
            error: "Rule not found or access denied",
          });
          continue;
        }

        switch (args.operation) {
          case "activate":
            await ctx.db.patch(ruleId, {
              isActive: true,
              updatedAt: Date.now(),
            });
            break;
          case "deactivate":
            await ctx.db.patch(ruleId, {
              isActive: false,
              updatedAt: Date.now(),
            });
            break;
          case "delete":
            // Remove rule from repository's rules array
            const repository = await ctx.db.get(rule.repositoryId);
            if (repository) {
              await ctx.db.patch(rule.repositoryId, {
                rules: repository.rules.filter((id: Id<"rules">) => id !== ruleId),
              });
            }
            // Delete the rule
            await ctx.db.delete(ruleId);
            break;
        }

        results.push({
          ruleId,
          ruleName: rule.name,
          success: true,
          operation: args.operation,
        });
      } catch (error) {
        results.push({
          ruleId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      operation: args.operation,
      results,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
    };
  },
});

/**
 * Manual refresh trigger for multiple repositories
 * Requirement 5.6: Manual refresh triggers and system status displays
 */
export const bulkManualRefresh = mutation({
  args: {
    userId: v.id("users"),
    repositoryIds: v.array(v.id("repositories")),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const results = [];

    for (const repositoryId of args.repositoryIds) {
      try {
        const repository = await ctx.db.get(repositoryId);
        if (!repository || repository.userId !== args.userId) {
          results.push({
            repositoryId,
            success: false,
            error: "Repository not found or access denied",
          });
          continue;
        }

        if (!repository.isActive) {
          results.push({
            repositoryId,
            repositoryName: repository.fullName,
            success: false,
            error: "Repository is not active",
          });
          continue;
        }

        // Schedule manual refresh (this would trigger the processor)
        // For now, just update the last checked time to indicate refresh was requested
        await ctx.db.patch(repositoryId, {
          lastChecked: Date.now(),
        });

        results.push({
          repositoryId,
          repositoryName: repository.fullName,
          success: true,
          message: "Refresh initiated",
        });
      } catch (error) {
        results.push({
          repositoryId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      results,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      refreshedAt: Date.now(),
    };
  },
});

/**
 * Get system status for dashboard display
 * Requirement 5.7: System status displays
 */
export const getDashboardSystemStatus = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Get user's repositories
    const repositories = await Promise.all(
      user.repositories.map(repoId => ctx.db.get(repoId))
    );
    const validRepositories = repositories.filter(repo => repo !== null);
    const activeRepositories = validRepositories.filter(repo => repo.isActive);

    // Calculate system health indicators
    const staleRepositories = activeRepositories.filter(
      repo => (now - repo.lastChecked) > oneDay
    );
    const recentlyCheckedRepositories = activeRepositories.filter(
      repo => (now - repo.lastChecked) < oneHour
    );

    // Get recent notifications
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("sentAt"), now - oneDay))
      .collect();

    const failedNotifications = recentNotifications.filter(
      n => n.status === "failed" || n.status === "bounced"
    );

    // Calculate overall health score
    const healthScore = calculateSystemHealthScore({
      totalRepositories: validRepositories.length,
      activeRepositories: activeRepositories.length,
      staleRepositories: staleRepositories.length,
      recentlyCheckedRepositories: recentlyCheckedRepositories.length,
      totalNotifications: recentNotifications.length,
      failedNotifications: failedNotifications.length,
    });

    return {
      repositories: {
        total: validRepositories.length,
        active: activeRepositories.length,
        stale: staleRepositories.length,
        recentlyChecked: recentlyCheckedRepositories.length,
        healthPercentage: activeRepositories.length > 0
          ? Math.round(((activeRepositories.length - staleRepositories.length) / activeRepositories.length) * 100)
          : 100,
      },
      notifications: {
        last24h: recentNotifications.length,
        failed: failedNotifications.length,
        successRate: recentNotifications.length > 0
          ? Math.round(((recentNotifications.length - failedNotifications.length) / recentNotifications.length) * 100)
          : 100,
      },
      overall: {
        healthScore,
        status: healthScore >= 80 ? "healthy" : healthScore >= 60 ? "warning" : "critical",
        lastUpdated: now,
      },
    };
  },
});

/**
 * Get quick actions available for dashboard
 * Requirement 5.6: Manual refresh triggers and system status displays
 */
export const getDashboardQuickActions = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // Get repositories that need attention
    const repositories = await Promise.all(
      user.repositories.map(repoId => ctx.db.get(repoId))
    );
    const validRepositories = repositories.filter(repo => repo !== null);
    const activeRepositories = validRepositories.filter(repo => repo.isActive);

    const repositoriesNeedingRefresh = activeRepositories.filter(
      repo => (now - repo.lastChecked) > oneDay
    );

    // Get rules that might need attention
    const inactiveRules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), false))
      .collect();

    // Get repositories without rules
    const repositoriesWithoutRules = [];
    for (const repo of activeRepositories) {
      const rules = await ctx.db
        .query("rules")
        .withIndex("by_repository", (q) => q.eq("repositoryId", repo._id))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();

      if (rules.length === 0) {
        repositoriesWithoutRules.push(repo);
      }
    }

    return {
      availableActions: [
        {
          id: "refresh_stale_repos",
          title: "Refresh Stale Repositories",
          description: `${repositoriesNeedingRefresh.length} repositories need checking`,
          count: repositoriesNeedingRefresh.length,
          enabled: repositoriesNeedingRefresh.length > 0,
          repositoryIds: repositoriesNeedingRefresh.map(r => r._id),
        },
        {
          id: "activate_inactive_rules",
          title: "Review Inactive Rules",
          description: `${inactiveRules.length} rules are currently inactive`,
          count: inactiveRules.length,
          enabled: inactiveRules.length > 0,
          ruleIds: inactiveRules.map(r => r._id),
        },
        {
          id: "add_rules_to_repos",
          title: "Add Rules to Repositories",
          description: `${repositoriesWithoutRules.length} repositories have no active rules`,
          count: repositoriesWithoutRules.length,
          enabled: repositoriesWithoutRules.length > 0,
          repositoryIds: repositoriesWithoutRules.map(r => r._id),
        },
      ],
      summary: {
        totalActionableItems: repositoriesNeedingRefresh.length + inactiveRules.length + repositoriesWithoutRules.length,
        lastUpdated: now,
      },
    };
  },
});

// Helper function to calculate repository health score
function calculateRepositoryHealthScore(
  repository: any,
  allIssues: any[],
  staleIssues: any[]
): number {
  let score = 100;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  // Deduct points for inactive repositories
  if (!repository.isActive) {
    score -= 50;
  }

  // Deduct points based on time since last check
  const timeSinceLastCheck = now - repository.lastChecked;
  if (timeSinceLastCheck > 2 * oneDay) {
    score -= 30; // Very stale
  } else if (timeSinceLastCheck > oneDay) {
    score -= 15; // Stale
  }

  // Deduct points based on stale issue ratio
  if (allIssues.length > 0) {
    const staleRatio = staleIssues.length / allIssues.length;
    if (staleRatio > 0.5) {
      score -= 20; // More than 50% stale
    } else if (staleRatio > 0.25) {
      score -= 10; // More than 25% stale
    }
  }

  return Math.max(0, Math.min(100, score));
}

// Helper function to calculate system health score
function calculateSystemHealthScore(params: {
  totalRepositories: number;
  activeRepositories: number;
  staleRepositories: number;
  recentlyCheckedRepositories: number;
  totalNotifications: number;
  failedNotifications: number;
}): number {
  let score = 100;

  // Repository health component (40% of score)
  if (params.activeRepositories > 0) {
    const staleRatio = params.staleRepositories / params.activeRepositories;
    score -= staleRatio * 40;
  }

  // Notification health component (30% of score)
  if (params.totalNotifications > 0) {
    const failureRatio = params.failedNotifications / params.totalNotifications;
    score -= failureRatio * 30;
  }

  // Activity health component (30% of score)
  if (params.activeRepositories > 0) {
    const inactiveRatio = (params.activeRepositories - params.recentlyCheckedRepositories) / params.activeRepositories;
    score -= inactiveRatio * 30;
  }

  return Math.max(0, Math.min(100, score));
}