// Convex functions for system monitoring and health checks
import { internalQuery, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { SystemMonitor, Logger } from "./lib/monitoring";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Perform comprehensive system health check
 */
export const performHealthCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    Logger.info("Starting system health check");
    const startTime = Date.now();

    try {
      const healthReport = await SystemMonitor.performHealthCheck(ctx);
      const duration = Date.now() - startTime;
      
      Logger.operation("system_health_check", duration, true, {
        overallStatus: healthReport.overall,
        componentCount: Object.keys(healthReport.components).length,
        alertCount: healthReport.alerts.length,
      });

      return healthReport;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.operation("system_health_check", duration, false, error);
      throw error;
    }
  },
});

/**
 * Perform data integrity checks
 */
export const performDataIntegrityChecks = internalQuery({
  args: {},
  handler: async (ctx) => {
    Logger.info("Starting data integrity checks");
    const startTime = Date.now();

    try {
      const integrityChecks = await SystemMonitor.performDataIntegrityChecks(ctx);
      const duration = Date.now() - startTime;
      
      const passedChecks = integrityChecks.filter(check => check.passed).length;
      const failedChecks = integrityChecks.length - passedChecks;

      Logger.operation("data_integrity_checks", duration, failedChecks === 0, {
        totalChecks: integrityChecks.length,
        passedChecks,
        failedChecks,
      });

      return integrityChecks;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.operation("data_integrity_checks", duration, false, error);
      throw error;
    }
  },
});

/**
 * Generate comprehensive system status report
 */
export const generateSystemStatusReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    Logger.info("Generating comprehensive system status report");
    const startTime = Date.now();

    try {
      const statusReport = await SystemMonitor.generateStatusReport(ctx);
      const duration = Date.now() - startTime;

      Logger.operation("system_status_report", duration, true, {
        overallHealth: statusReport.health.overall,
        integrityChecksPassed: statusReport.integrityChecks.filter(c => c.passed).length,
        totalIntegrityChecks: statusReport.integrityChecks.length,
        recommendationCount: statusReport.recommendations.length,
      });

      return statusReport;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.operation("system_status_report", duration, false, error);
      throw error;
    }
  },
});

/**
 * Get system metrics for dashboard display
 */
export const getSystemMetrics = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Only allow authenticated users to view system metrics
    // In production, you might want to restrict this to admin users
    
    try {
      const healthCheck = await SystemMonitor.performHealthCheck(ctx);
      
      return {
        overall: healthCheck.overall,
        metrics: healthCheck.metrics,
        components: healthCheck.components,
        timestamp: healthCheck.timestamp,
      };
    } catch (error) {
      Logger.error("Failed to get system metrics", error);
      throw new Error("Failed to retrieve system metrics");
    }
  },
});

/**
 * Get detailed health status for admin dashboard
 */
export const getDetailedHealthStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // In production, add admin role check here
    
    try {
      const statusReport = await SystemMonitor.generateStatusReport(ctx);
      
      return {
        health: statusReport.health,
        integrityChecks: statusReport.integrityChecks,
        recommendations: statusReport.recommendations,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error("Failed to get detailed health status", error);
      throw new Error("Failed to retrieve detailed health status");
    }
  },
});

/**
 * Log system operation for monitoring
 */
export const logSystemOperation = internalMutation({
  args: {
    operation: v.string(),
    duration: v.number(),
    success: v.boolean(),
    details: v.optional(v.any()),
    userId: v.optional(v.id("users")),
    repositoryId: v.optional(v.id("repositories")),
  },
  handler: async (ctx, args) => {
    // In production, this would store operation logs in a dedicated collection
    // For now, we'll use the Logger utility
    
    Logger.operation(args.operation, args.duration, args.success, {
      ...args.details,
      userId: args.userId,
      repositoryId: args.repositoryId,
    });

    // Could be extended to:
    // - Store in operations_log collection
    // - Send metrics to external monitoring service
    // - Trigger alerts based on operation patterns
    
    return { logged: true, timestamp: Date.now() };
  },
});

/**
 * Get repository processing statistics
 */
export const getRepositoryProcessingStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    try {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const oneDay = 24 * oneHour;

      // Get all repositories
      const allRepositories = await ctx.db.query("repositories").collect();
      const activeRepositories = allRepositories.filter(r => r.isActive);

      // Categorize by last check time
      const stats = {
        total: allRepositories.length,
        active: activeRepositories.length,
        checkedLastHour: activeRepositories.filter(r => (now - r.lastChecked) < oneHour).length,
        checkedLast6Hours: activeRepositories.filter(r => (now - r.lastChecked) < 6 * oneHour).length,
        checkedLastDay: activeRepositories.filter(r => (now - r.lastChecked) < oneDay).length,
        neverChecked: activeRepositories.filter(r => r.lastChecked === 0).length,
        stale: activeRepositories.filter(r => (now - r.lastChecked) > oneDay).length,
      };

      // Calculate health percentage
      const healthyCount = stats.checkedLastHour + stats.checkedLast6Hours;
      const healthPercentage = activeRepositories.length > 0 
        ? Math.round((healthyCount / activeRepositories.length) * 100)
        : 100;

      return {
        ...stats,
        healthPercentage,
        timestamp: now,
      };
    } catch (error) {
      Logger.error("Failed to get repository processing stats", error);
      throw new Error("Failed to retrieve repository processing statistics");
    }
  },
});

/**
 * Get error summary for monitoring dashboard
 */
export const getErrorSummary = query({
  args: {
    timeRange: v.optional(v.union(v.literal("1h"), v.literal("6h"), v.literal("24h"), v.literal("7d"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const timeRange = args.timeRange || "24h";
    const now = Date.now();
    
    let cutoffTime: number;
    switch (timeRange) {
      case "1h":
        cutoffTime = now - 60 * 60 * 1000;
        break;
      case "6h":
        cutoffTime = now - 6 * 60 * 60 * 1000;
        break;
      case "24h":
        cutoffTime = now - 24 * 60 * 60 * 1000;
        break;
      case "7d":
        cutoffTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        cutoffTime = now - 24 * 60 * 60 * 1000;
    }

    try {
      // In production, this would query an errors collection
      // For now, we'll return a placeholder structure
      
      const errorSummary = {
        timeRange,
        totalErrors: 0,
        errorsByType: {
          authentication: 0,
          rate_limit: 0,
          repository_access: 0,
          github_api: 0,
          database: 0,
          email_delivery: 0,
          network: 0,
          unknown: 0,
        },
        errorsBySeverity: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
        topErrorMessages: [],
        affectedRepositories: 0,
        affectedUsers: 0,
        timestamp: now,
      };

      return errorSummary;
    } catch (error) {
      Logger.error("Failed to get error summary", error);
      throw new Error("Failed to retrieve error summary");
    }
  },
});

/**
 * Trigger manual system health check
 */
export const triggerHealthCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    Logger.info("Manual health check triggered");
    
    try {
      const healthReport = await SystemMonitor.performHealthCheck(ctx);
      
      // Log the health check results
      Logger.info("Manual health check completed", {
        overall: healthReport.overall,
        components: Object.keys(healthReport.components).reduce((acc, key) => {
          acc[key] = healthReport.components[key as keyof typeof healthReport.components].status;
          return acc;
        }, {} as Record<string, string>),
      });

      return {
        success: true,
        health: healthReport,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error("Manual health check failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      };
    }
  },
});

/**
 * Clean up old data for maintenance
 */
export const performDataCleanup = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    maxAge: v.optional(v.number()), // milliseconds
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxAge = args.maxAge ?? 30 * 24 * 60 * 60 * 1000; // 30 days default
    const cutoffTime = Date.now() - maxAge;

    Logger.info(`Starting data cleanup (dry run: ${dryRun})`);

    try {
      const cleanupResults = {
        oldNotifications: 0,
        orphanedIssues: 0,
        inactiveUsers: 0,
        totalCleaned: 0,
      };

      // Clean up old notification records
      const oldNotifications = await ctx.db
        .query("notifications")
        .filter((q: any) => q.lt(q.field("sentAt"), cutoffTime))
        .collect();

      if (!dryRun) {
        for (const notification of oldNotifications) {
          await ctx.db.delete(notification._id);
        }
      }
      cleanupResults.oldNotifications = oldNotifications.length;

      // Clean up orphaned issues (issues from inactive repositories)
      const inactiveRepositories = await ctx.db
        .query("repositories")
        .filter((q: any) => q.eq(q.field("isActive"), false))
        .collect();

      const inactiveRepoIds = inactiveRepositories.map(r => r._id);
      let orphanedIssuesCount = 0;

      for (const repoId of inactiveRepoIds) {
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_repository", (q: any) => q.eq("repositoryId", repoId))
          .collect();

        if (!dryRun) {
          for (const issue of issues) {
            await ctx.db.delete(issue._id);
          }
        }
        orphanedIssuesCount += issues.length;
      }
      cleanupResults.orphanedIssues = orphanedIssuesCount;

      cleanupResults.totalCleaned = cleanupResults.oldNotifications + cleanupResults.orphanedIssues;

      Logger.operation("data_cleanup", Date.now() - Date.now(), true, {
        dryRun,
        ...cleanupResults,
      });

      return {
        success: true,
        dryRun,
        results: cleanupResults,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error("Data cleanup failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      };
    }
  },
});