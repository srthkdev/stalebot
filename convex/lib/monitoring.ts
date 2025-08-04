// System monitoring and health check utilities
import { Id } from "../_generated/dataModel";

export interface SystemHealth {
  overall: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  components: {
    database: ComponentHealth;
    githubApi: ComponentHealth;
    emailService: ComponentHealth;
    cronJobs: ComponentHealth;
  };
  metrics: SystemMetrics;
  alerts: SystemAlert[];
}

export interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: number;
  responseTime?: number;
  errorRate?: number;
  details?: Record<string, any>;
}

export interface SystemMetrics {
  totalRepositories: number;
  activeRepositories: number;
  totalUsers: number;
  activeUsers: number;
  issuesProcessed24h: number;
  emailsSent24h: number;
  errorCount24h: number;
  averageProcessingTime: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface SystemAlert {
  id: string;
  type: "error" | "warning" | "info";
  component: string;
  message: string;
  timestamp: number;
  severity: "low" | "medium" | "high" | "critical";
  resolved: boolean;
  details?: Record<string, any>;
}

export interface DataIntegrityCheck {
  checkName: string;
  passed: boolean;
  message: string;
  timestamp: number;
  details?: Record<string, any>;
}

export class SystemMonitor {
  /**
   * Perform comprehensive system health check
   */
  static async performHealthCheck(ctx: any): Promise<SystemHealth> {
    const startTime = Date.now();
    console.log("Starting comprehensive system health check...");

    const components = {
      database: await this.checkDatabaseHealth(ctx),
      githubApi: await this.checkGitHubApiHealth(ctx),
      emailService: await this.checkEmailServiceHealth(ctx),
      cronJobs: await this.checkCronJobHealth(ctx),
    };

    const metrics = await this.collectSystemMetrics(ctx);
    const alerts = await this.getActiveAlerts(ctx);

    // Determine overall health
    const componentStatuses = Object.values(components).map(c => c.status);
    let overall: "healthy" | "degraded" | "unhealthy";

    if (componentStatuses.every(s => s === "healthy")) {
      overall = "healthy";
    } else if (componentStatuses.some(s => s === "unhealthy")) {
      overall = "unhealthy";
    } else {
      overall = "degraded";
    }

    const healthCheck: SystemHealth = {
      overall,
      timestamp: startTime,
      components,
      metrics,
      alerts,
    };

    const duration = Date.now() - startTime;
    console.log(`System health check completed in ${duration}ms - Status: ${overall}`);

    return healthCheck;
  }

  /**
   * Check database connectivity and performance
   */
  private static async checkDatabaseHealth(ctx: any): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // Test basic database operations
      const repositoryCount = await ctx.db.query("repositories").collect().then((r: any[]) => r.length);
      const userCount = await ctx.db.query("users").collect().then((u: any[]) => u.length);
      
      // Test query performance
      const queryStartTime = Date.now();
      await ctx.db.query("repositories").withIndex("by_active", (q: any) => q.eq("isActive", true)).collect();
      const queryTime = Date.now() - queryStartTime;

      const responseTime = Date.now() - startTime;

      // Determine health based on response time and data consistency
      let status: "healthy" | "degraded" | "unhealthy";
      if (responseTime < 100 && queryTime < 50) {
        status = "healthy";
      } else if (responseTime < 500 && queryTime < 200) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }

      return {
        status,
        lastCheck: Date.now(),
        responseTime,
        details: {
          repositoryCount,
          userCount,
          queryTime,
          connectionStatus: "connected",
        },
      };
    } catch (error) {
      console.error("Database health check failed:", error);
      return {
        status: "unhealthy",
        lastCheck: Date.now(),
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          connectionStatus: "failed",
        },
      };
    }
  }

  /**
   * Check GitHub API connectivity and rate limits
   */
  private static async checkGitHubApiHealth(ctx: any): Promise<ComponentHealth> {
    const startTime = Date.now();
    
    try {
      // Get a user with valid tokens for testing
      const testUser = await ctx.db
        .query("users")
        .filter((q: any) => q.neq(q.field("accessToken"), ""))
        .first();

      if (!testUser) {
        return {
          status: "degraded",
          lastCheck: Date.now(),
          details: {
            message: "No users with valid tokens for API testing",
            testPerformed: false,
          },
        };
      }

      // Test GitHub API with a simple rate limit check
      const { decryptToken } = await import("./encryption");
      const accessToken = decryptToken(testUser.accessToken);
      
      const response = await fetch("https://api.github.com/rate_limit", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "StaleBot/1.0",
        },
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return {
          status: "unhealthy",
          lastCheck: Date.now(),
          responseTime,
          details: {
            httpStatus: response.status,
            error: `GitHub API returned ${response.status}`,
            testPerformed: true,
          },
        };
      }

      const rateLimitData = await response.json();
      const remaining = rateLimitData.rate.remaining;
      const limit = rateLimitData.rate.limit;
      const resetTime = rateLimitData.rate.reset * 1000;

      // Determine health based on rate limit status
      let status: "healthy" | "degraded" | "unhealthy";
      const usagePercentage = ((limit - remaining) / limit) * 100;

      if (usagePercentage < 70) {
        status = "healthy";
      } else if (usagePercentage < 90) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }

      return {
        status,
        lastCheck: Date.now(),
        responseTime,
        details: {
          rateLimitRemaining: remaining,
          rateLimitTotal: limit,
          rateLimitReset: resetTime,
          usagePercentage: Math.round(usagePercentage),
          testPerformed: true,
        },
      };
    } catch (error) {
      console.error("GitHub API health check failed:", error);
      return {
        status: "unhealthy",
        lastCheck: Date.now(),
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          testPerformed: true,
        },
      };
    }
  }

  /**
   * Check email service health (Resend component)
   */
  private static async checkEmailServiceHealth(ctx: any): Promise<ComponentHealth> {
    // Since we can't easily test email sending without actually sending emails,
    // we'll check for recent email activity and configuration
    
    try {
      // Check for recent notification records
      const recentNotifications = await ctx.db
        .query("notifications")
        .filter((q: any) => q.gt(q.field("sentAt"), Date.now() - 24 * 60 * 60 * 1000))
        .collect();

      const successfulEmails = recentNotifications.filter((n: any) => 
        n.status === "sent" || n.status === "delivered"
      ).length;

      const failedEmails = recentNotifications.filter((n: any) => 
        n.status === "failed" || n.status === "bounced"
      ).length;

      const totalEmails = recentNotifications.length;
      const successRate = totalEmails > 0 ? (successfulEmails / totalEmails) * 100 : 100;

      // Determine health based on success rate
      let status: "healthy" | "degraded" | "unhealthy";
      if (successRate >= 95) {
        status = "healthy";
      } else if (successRate >= 85) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }

      return {
        status,
        lastCheck: Date.now(),
        details: {
          emailsSent24h: totalEmails,
          successfulEmails,
          failedEmails,
          successRate: Math.round(successRate),
          configurationStatus: "configured", // Would check actual config in production
        },
      };
    } catch (error) {
      console.error("Email service health check failed:", error);
      return {
        status: "unhealthy",
        lastCheck: Date.now(),
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          configurationStatus: "unknown",
        },
      };
    }
  }

  /**
   * Check cron job execution health
   */
  private static async checkCronJobHealth(ctx: any): Promise<ComponentHealth> {
    try {
      // Check when repositories were last processed
      const repositories = await ctx.db
        .query("repositories")
        .withIndex("by_active", (q: any) => q.eq("isActive", true))
        .collect();

      if (repositories.length === 0) {
        return {
          status: "healthy",
          lastCheck: Date.now(),
          details: {
            message: "No active repositories to monitor",
            activeRepositories: 0,
          },
        };
      }

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const sixHours = 6 * oneHour;
      const oneDay = 24 * oneHour;

      const recentlyChecked = repositories.filter((r: any) => (now - r.lastChecked) < oneHour).length;
      const staleChecks = repositories.filter((r: any) => (now - r.lastChecked) > sixHours).length;
      const veryStaleChecks = repositories.filter((r: any) => (now - r.lastChecked) > oneDay).length;

      // Determine health based on how recently repositories were checked
      let status: "healthy" | "degraded" | "unhealthy";
      const stalePercentage = (staleChecks / repositories.length) * 100;
      const veryStalePercentage = (veryStaleChecks / repositories.length) * 100;

      if (veryStalePercentage > 20) {
        status = "unhealthy";
      } else if (stalePercentage > 50) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      return {
        status,
        lastCheck: Date.now(),
        details: {
          totalRepositories: repositories.length,
          recentlyChecked,
          staleChecks,
          veryStaleChecks,
          stalePercentage: Math.round(stalePercentage),
          veryStalePercentage: Math.round(veryStalePercentage),
        },
      };
    } catch (error) {
      console.error("Cron job health check failed:", error);
      return {
        status: "unhealthy",
        lastCheck: Date.now(),
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Collect comprehensive system metrics
   */
  private static async collectSystemMetrics(ctx: any): Promise<SystemMetrics> {
    try {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Basic counts
      const allRepositories = await ctx.db.query("repositories").collect();
      const activeRepositories = allRepositories.filter((r: any) => r.isActive);
      const allUsers = await ctx.db.query("users").collect();
      const activeUsers = allUsers.filter((u: any) => (now - u.lastActive) < 7 * 24 * 60 * 60 * 1000); // Active in last week

      // Activity metrics
      const recentNotifications = await ctx.db
        .query("notifications")
        .filter((q: any) => q.gt(q.field("sentAt"), oneDayAgo))
        .collect();

      // Calculate average processing time (would need to track this in production)
      const averageProcessingTime = 5000; // Placeholder - would calculate from actual data

      // Error metrics (would come from error tracking system)
      const errorCount24h = 0; // Placeholder - would query error collection

      return {
        totalRepositories: allRepositories.length,
        activeRepositories: activeRepositories.length,
        totalUsers: allUsers.length,
        activeUsers: activeUsers.length,
        issuesProcessed24h: 0, // Would track this in production
        emailsSent24h: recentNotifications.length,
        errorCount24h,
        averageProcessingTime,
      };
    } catch (error) {
      console.error("Failed to collect system metrics:", error);
      return {
        totalRepositories: 0,
        activeRepositories: 0,
        totalUsers: 0,
        activeUsers: 0,
        issuesProcessed24h: 0,
        emailsSent24h: 0,
        errorCount24h: 0,
        averageProcessingTime: 0,
      };
    }
  }

  /**
   * Get active system alerts
   */
  private static async getActiveAlerts(ctx: any): Promise<SystemAlert[]> {
    // In production, this would query an alerts collection
    // For now, we'll return an empty array
    return [];
  }

  /**
   * Perform data integrity checks
   */
  static async performDataIntegrityChecks(ctx: any): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    // Check for orphaned repositories (repositories without users)
    try {
      const repositories = await ctx.db.query("repositories").collect();
      const orphanedRepos = [];

      for (const repo of repositories) {
        const user = await ctx.db.get(repo.userId);
        if (!user) {
          orphanedRepos.push(repo);
        }
      }

      checks.push({
        checkName: "orphaned_repositories",
        passed: orphanedRepos.length === 0,
        message: orphanedRepos.length === 0 
          ? "No orphaned repositories found"
          : `Found ${orphanedRepos.length} repositories without valid users`,
        timestamp: Date.now(),
        details: { orphanedCount: orphanedRepos.length },
      });
    } catch (error) {
      checks.push({
        checkName: "orphaned_repositories",
        passed: false,
        message: "Failed to check for orphaned repositories",
        timestamp: Date.now(),
        details: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Check for rules without repositories
    try {
      const rules = await ctx.db.query("rules").collect();
      const orphanedRules = [];

      for (const rule of rules) {
        const repository = await ctx.db.get(rule.repositoryId);
        if (!repository) {
          orphanedRules.push(rule);
        }
      }

      checks.push({
        checkName: "orphaned_rules",
        passed: orphanedRules.length === 0,
        message: orphanedRules.length === 0
          ? "No orphaned rules found"
          : `Found ${orphanedRules.length} rules without valid repositories`,
        timestamp: Date.now(),
        details: { orphanedCount: orphanedRules.length },
      });
    } catch (error) {
      checks.push({
        checkName: "orphaned_rules",
        passed: false,
        message: "Failed to check for orphaned rules",
        timestamp: Date.now(),
        details: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Check for issues without repositories
    try {
      const issues = await ctx.db.query("issues").collect();
      const orphanedIssues = [];

      for (const issue of issues.slice(0, 100)) { // Sample check to avoid timeout
        const repository = await ctx.db.get(issue.repositoryId);
        if (!repository) {
          orphanedIssues.push(issue);
        }
      }

      checks.push({
        checkName: "orphaned_issues",
        passed: orphanedIssues.length === 0,
        message: orphanedIssues.length === 0
          ? "No orphaned issues found (sample check)"
          : `Found ${orphanedIssues.length} issues without valid repositories (sample check)`,
        timestamp: Date.now(),
        details: { 
          orphanedCount: orphanedIssues.length,
          sampleSize: Math.min(issues.length, 100),
          totalIssues: issues.length,
        },
      });
    } catch (error) {
      checks.push({
        checkName: "orphaned_issues",
        passed: false,
        message: "Failed to check for orphaned issues",
        timestamp: Date.now(),
        details: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Check for notification records without users
    try {
      const notifications = await ctx.db.query("notifications").collect();
      const orphanedNotifications = [];

      for (const notification of notifications.slice(0, 50)) { // Sample check
        const user = await ctx.db.get(notification.userId);
        if (!user) {
          orphanedNotifications.push(notification);
        }
      }

      checks.push({
        checkName: "orphaned_notifications",
        passed: orphanedNotifications.length === 0,
        message: orphanedNotifications.length === 0
          ? "No orphaned notifications found (sample check)"
          : `Found ${orphanedNotifications.length} notifications without valid users (sample check)`,
        timestamp: Date.now(),
        details: { 
          orphanedCount: orphanedNotifications.length,
          sampleSize: Math.min(notifications.length, 50),
          totalNotifications: notifications.length,
        },
      });
    } catch (error) {
      checks.push({
        checkName: "orphaned_notifications",
        passed: false,
        message: "Failed to check for orphaned notifications",
        timestamp: Date.now(),
        details: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Check for data consistency issues
    try {
      const users = await ctx.db.query("users").collect();
      const usersWithoutTokens = users.filter((u: any) => !u.accessToken || u.accessToken === "");
      const usersWithoutEmail = users.filter((u: any) => !u.email || u.email === "");

      checks.push({
        checkName: "user_data_consistency",
        passed: usersWithoutTokens.length === 0 && usersWithoutEmail.length === 0,
        message: `User data consistency check: ${usersWithoutTokens.length} users without tokens, ${usersWithoutEmail.length} users without email`,
        timestamp: Date.now(),
        details: { 
          usersWithoutTokens: usersWithoutTokens.length,
          usersWithoutEmail: usersWithoutEmail.length,
          totalUsers: users.length,
        },
      });
    } catch (error) {
      checks.push({
        checkName: "user_data_consistency",
        passed: false,
        message: "Failed to check user data consistency",
        timestamp: Date.now(),
        details: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    return checks;
  }

  /**
   * Generate system status report
   */
  static async generateStatusReport(ctx: any): Promise<{
    health: SystemHealth;
    integrityChecks: DataIntegrityCheck[];
    recommendations: string[];
  }> {
    console.log("Generating comprehensive system status report...");

    const health = await this.performHealthCheck(ctx);
    const integrityChecks = await this.performDataIntegrityChecks(ctx);
    const recommendations = this.generateRecommendations(health, integrityChecks);

    return {
      health,
      integrityChecks,
      recommendations,
    };
  }

  /**
   * Generate recommendations based on health and integrity checks
   */
  private static generateRecommendations(
    health: SystemHealth,
    integrityChecks: DataIntegrityCheck[]
  ): string[] {
    const recommendations: string[] = [];

    // Health-based recommendations
    if (health.overall === "unhealthy") {
      recommendations.push("🚨 System is unhealthy - immediate attention required");
    } else if (health.overall === "degraded") {
      recommendations.push("⚠️ System performance is degraded - investigation recommended");
    }

    // Component-specific recommendations
    if (health.components.database.status === "unhealthy") {
      recommendations.push("Database connectivity issues detected - check database connection and performance");
    }

    if (health.components.githubApi.status === "unhealthy") {
      recommendations.push("GitHub API issues detected - check rate limits and authentication");
    }

    if (health.components.emailService.status === "unhealthy") {
      recommendations.push("Email service issues detected - check Resend configuration and delivery rates");
    }

    if (health.components.cronJobs.status === "unhealthy") {
      recommendations.push("Cron job execution issues detected - many repositories have stale check times");
    }

    // Integrity-based recommendations
    const failedChecks = integrityChecks.filter(check => !check.passed);
    if (failedChecks.length > 0) {
      recommendations.push(`Data integrity issues detected: ${failedChecks.length} checks failed`);
      
      failedChecks.forEach(check => {
        if (check.checkName === "orphaned_repositories") {
          recommendations.push("Clean up orphaned repositories without valid users");
        } else if (check.checkName === "orphaned_rules") {
          recommendations.push("Clean up orphaned rules without valid repositories");
        } else if (check.checkName === "orphaned_issues") {
          recommendations.push("Clean up orphaned issues without valid repositories");
        } else if (check.checkName === "user_data_consistency") {
          recommendations.push("Fix user data consistency issues (missing tokens or emails)");
        }
      });
    }

    // Metric-based recommendations
    if (health.metrics.errorCount24h > 10) {
      recommendations.push("High error rate detected - investigate error patterns and root causes");
    }

    if (health.metrics.activeUsers / health.metrics.totalUsers < 0.5) {
      recommendations.push("Low user activity detected - consider user engagement strategies");
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ System is operating normally - no immediate action required");
    }

    return recommendations;
  }
}

/**
 * Comprehensive logging utility with different log levels
 */
export class Logger {
  static info(message: string, data?: any): void {
    console.info(`[INFO] ${new Date().toISOString()} - ${message}`, data || "");
  }

  static warn(message: string, data?: any): void {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data || "");
  }

  static error(message: string, error?: any): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error || "");
  }

  static debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, data || "");
    }
  }

  static operation(operation: string, duration: number, success: boolean, details?: any): void {
    const status = success ? "SUCCESS" : "FAILED";
    const message = `[OPERATION] ${operation} - ${status} in ${duration}ms`;
    
    if (success) {
      console.info(message, details || "");
    } else {
      console.error(message, details || "");
    }
  }
}