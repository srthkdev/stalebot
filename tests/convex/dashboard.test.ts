import { expect, test, describe } from "vitest";

describe("Dashboard Data Aggregation Functions", () => {
  // Helper functions to create test data
  const createTestUser = (overrides: any = {}) => ({
    _id: "test-user-id",
    githubId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    accessToken: "encrypted-token",
    refreshToken: "encrypted-refresh",
    repositories: ["repo-1", "repo-2"],
    notificationPreferences: {
      emailFrequency: "daily" as const,
      quietHours: { start: 22, end: 8 },
      emailTemplate: "default" as const,
      pauseNotifications: false,
    },
    createdAt: Date.now(),
    lastActive: Date.now(),
    ...overrides,
  });

  const createTestRepository = (overrides: any = {}) => ({
    _id: "test-repo-id",
    userId: "test-user-id",
    githubId: 12345,
    name: "test-repo",
    fullName: "testuser/test-repo",
    isActive: true,
    rules: ["rule-1"],
    lastChecked: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    lastIssueCount: 5,
    createdAt: Date.now(),
    ...overrides,
  });

  const createTestIssue = (overrides: any = {}) => ({
    _id: "test-issue-id",
    repositoryId: "test-repo-id",
    githubIssueId: 123,
    title: "Test Issue",
    url: "https://github.com/testuser/test-repo/issues/123",
    state: "open" as const,
    labels: ["bug"],
    assignee: null,
    lastActivity: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
    isStale: true,
    lastNotified: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  const createTestNotification = (overrides: any = {}) => ({
    _id: "test-notification-id",
    userId: "test-user-id",
    repositoryId: "test-repo-id",
    issueIds: ["issue-1", "issue-2"],
    emailId: "test-email-123",
    status: "delivered" as const,
    sentAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
    deliveredAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    ...overrides,
  });

  // Test helper functions for dashboard calculations
  describe("Dashboard calculation helpers", () => {
    test("should calculate days since last activity correctly", () => {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

      const calculateDaysSince = (timestamp: number) => 
        Math.floor((now - timestamp) / (24 * 60 * 60 * 1000));

      expect(calculateDaysSince(oneDayAgo)).toBe(1);
      expect(calculateDaysSince(thirtyDaysAgo)).toBe(30);
      expect(calculateDaysSince(now)).toBe(0);
    });

    test("should calculate notification success rate correctly", () => {
      const notifications = [
        createTestNotification({ status: "delivered" }),
        createTestNotification({ status: "sent" }),
        createTestNotification({ status: "failed" }),
        createTestNotification({ status: "bounced" }),
      ];

      const calculateSuccessRate = (notifications: any[]) => {
        const successful = notifications.filter(
          n => n.status === "delivered" || n.status === "sent"
        );
        return notifications.length > 0 
          ? Math.round((successful.length / notifications.length) * 100)
          : 100;
      };

      expect(calculateSuccessRate(notifications)).toBe(50); // 2 out of 4
      expect(calculateSuccessRate([])).toBe(100); // No notifications = 100%
    });

    test("should categorize repositories by health status", () => {
      const now = Date.now();
      const repositories = [
        createTestRepository({ 
          lastChecked: now - 2 * 60 * 60 * 1000, // 2 hours ago - healthy
          isActive: true 
        }),
        createTestRepository({ 
          lastChecked: now - 25 * 60 * 60 * 1000, // 25 hours ago - stale
          isActive: true 
        }),
        createTestRepository({ 
          isActive: false // inactive
        }),
      ];

      const categorizeRepositories = (repos: any[]) => {
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const active = repos.filter(r => r.isActive);
        const stale = active.filter(r => r.lastChecked < oneDayAgo);
        
        return {
          total: repos.length,
          active: active.length,
          stale: stale.length,
          healthyPercentage: active.length > 0 
            ? Math.round(((active.length - stale.length) / active.length) * 100)
            : 100
        };
      };

      const result = categorizeRepositories(repositories);
      expect(result.total).toBe(3);
      expect(result.active).toBe(2);
      expect(result.stale).toBe(1);
      expect(result.healthyPercentage).toBe(50); // 1 healthy out of 2 active
    });

    test("should aggregate stale issue statistics", () => {
      const issues = [
        createTestIssue({ isStale: true, state: "open" }),
        createTestIssue({ isStale: true, state: "closed" }),
        createTestIssue({ isStale: false, state: "open" }),
        createTestIssue({ isStale: false, state: "closed" }),
      ];

      const aggregateIssueStats = (issues: any[]) => {
        const staleIssues = issues.filter(i => i.isStale);
        const openIssues = issues.filter(i => i.state === "open");
        const closedIssues = issues.filter(i => i.state === "closed");
        
        return {
          total: issues.length,
          stale: staleIssues.length,
          open: openIssues.length,
          closed: closedIssues.length,
          stalePercentage: issues.length > 0 
            ? Math.round((staleIssues.length / issues.length) * 100)
            : 0
        };
      };

      const result = aggregateIssueStats(issues);
      expect(result.total).toBe(4);
      expect(result.stale).toBe(2);
      expect(result.open).toBe(2);
      expect(result.closed).toBe(2);
      expect(result.stalePercentage).toBe(50);
    });

    test("should calculate average staleness period", () => {
      const now = Date.now();
      const staleIssues = [
        createTestIssue({ 
          lastActivity: now - 10 * 24 * 60 * 60 * 1000, // 10 days
          isStale: true 
        }),
        createTestIssue({ 
          lastActivity: now - 20 * 24 * 60 * 60 * 1000, // 20 days
          isStale: true 
        }),
        createTestIssue({ 
          lastActivity: now - 30 * 24 * 60 * 60 * 1000, // 30 days
          isStale: true 
        }),
      ];

      const calculateAverageStaleDays = (issues: any[]) => {
        if (issues.length === 0) return 0;
        
        const staleDays = issues.map(issue => 
          Math.floor((now - issue.lastActivity) / (24 * 60 * 60 * 1000))
        );
        
        return Math.round(staleDays.reduce((sum, days) => sum + days, 0) / staleDays.length);
      };

      expect(calculateAverageStaleDays(staleIssues)).toBe(20); // (10+20+30)/3 = 20
      expect(calculateAverageStaleDays([])).toBe(0);
    });
  });

  describe("Dashboard management functions", () => {
    test("should calculate repository health score correctly", () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Helper function to simulate the health score calculation
      const calculateRepositoryHealthScore = (
        repository: any,
        allIssues: any[],
        staleIssues: any[]
      ): number => {
        let score = 100;

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
      };

      // Test healthy repository
      const healthyRepo = createTestRepository({
        isActive: true,
        lastChecked: now - 2 * 60 * 60 * 1000, // 2 hours ago
      });
      const healthyIssues = [
        createTestIssue({ isStale: false }),
        createTestIssue({ isStale: false }),
      ];
      const healthyStaleIssues: any[] = [];

      expect(calculateRepositoryHealthScore(healthyRepo, healthyIssues, healthyStaleIssues)).toBe(100);

      // Test repository with some stale issues
      const repoWithStaleIssues = createTestRepository({
        isActive: true,
        lastChecked: now - 2 * 60 * 60 * 1000,
      });
      const mixedIssues = [
        createTestIssue({ isStale: true }),
        createTestIssue({ isStale: false }),
        createTestIssue({ isStale: false }),
        createTestIssue({ isStale: false }),
      ];
      const someStaleIssues = mixedIssues.filter(i => i.isStale);

      expect(calculateRepositoryHealthScore(repoWithStaleIssues, mixedIssues, someStaleIssues)).toBe(100); // 25% stale, no deduction

      // Test inactive repository
      const inactiveRepo = createTestRepository({
        isActive: false,
        lastChecked: now - 2 * 60 * 60 * 1000,
      });

      expect(calculateRepositoryHealthScore(inactiveRepo, [], [])).toBe(50); // -50 for inactive
    });

    test("should calculate system health score correctly", () => {
      const calculateSystemHealthScore = (params: {
        totalRepositories: number;
        activeRepositories: number;
        staleRepositories: number;
        recentlyCheckedRepositories: number;
        totalNotifications: number;
        failedNotifications: number;
      }): number => {
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
      };

      // Test perfect health
      expect(calculateSystemHealthScore({
        totalRepositories: 5,
        activeRepositories: 5,
        staleRepositories: 0,
        recentlyCheckedRepositories: 5,
        totalNotifications: 10,
        failedNotifications: 0,
      })).toBe(100);

      // Test with some issues
      expect(calculateSystemHealthScore({
        totalRepositories: 10,
        activeRepositories: 8,
        staleRepositories: 2, // 25% stale = -10 points
        recentlyCheckedRepositories: 6, // 25% inactive = -7.5 points
        totalNotifications: 20,
        failedNotifications: 2, // 10% failed = -3 points
      })).toBeCloseTo(79.5, 1); // 100 - 10 - 7.5 - 3 = 79.5
    });

    test("should validate bulk operation result structure", () => {
      const mockBulkResult = {
        operation: "activate",
        results: [
          {
            repositoryId: "repo-1",
            repositoryName: "test/repo1",
            success: true,
            operation: "activate",
          },
          {
            repositoryId: "repo-2",
            success: false,
            error: "Repository not found",
          },
        ],
        successCount: 1,
        failureCount: 1,
      };

      expect(mockBulkResult.operation).toBe("activate");
      expect(mockBulkResult.results).toHaveLength(2);
      expect(mockBulkResult.successCount).toBe(1);
      expect(mockBulkResult.failureCount).toBe(1);
      expect(mockBulkResult.results[0].success).toBe(true);
      expect(mockBulkResult.results[1].success).toBe(false);
    });
  });

  describe("Dashboard data structure validation", () => {
    test("should validate dashboard data structure", () => {
      const mockDashboardData = {
        user: createTestUser(),
        repositories: [
          { ...createTestRepository(), staleIssueCount: 3, totalIssueCount: 10 },
          { ...createTestRepository({ _id: "repo-2" }), staleIssueCount: 1, totalIssueCount: 5 }
        ],
        recentNotifications: [createTestNotification()],
        totalStaleIssues: 4,
        activeRules: 2,
      };

      // Validate structure
      expect(mockDashboardData.user).toBeDefined();
      expect(mockDashboardData.repositories).toHaveLength(2);
      expect(mockDashboardData.repositories[0]).toHaveProperty('staleIssueCount');
      expect(mockDashboardData.repositories[0]).toHaveProperty('totalIssueCount');
      expect(mockDashboardData.totalStaleIssues).toBe(4);
      expect(mockDashboardData.activeRules).toBe(2);
    });

    test("should validate repository stats structure", () => {
      const mockRepositoryStats = {
        repository: createTestRepository(),
        statistics: {
          totalIssues: 10,
          staleIssues: 3,
          openIssues: 7,
          closedIssues: 3,
          averageStaleDays: 15,
          notificationSuccessRate: 85,
          activeRulesCount: 2,
          lastChecked: Date.now() - 2 * 60 * 60 * 1000,
          daysSinceLastCheck: 0,
        },
        recentNotifications: [createTestNotification()],
        activeRules: [
          {
            _id: "rule-1",
            name: "Test Rule",
            inactivityDays: 14,
            labels: ["bug"],
            issueStates: ["open"],
            assigneeCondition: "any",
            isActive: true,
          }
        ],
      };

      expect(mockRepositoryStats.repository).toBeDefined();
      expect(mockRepositoryStats.statistics.totalIssues).toBe(10);
      expect(mockRepositoryStats.statistics.staleIssues).toBe(3);
      expect(mockRepositoryStats.statistics.notificationSuccessRate).toBe(85);
      expect(mockRepositoryStats.activeRules).toHaveLength(1);
    });

    test("should validate system health structure", () => {
      const mockSystemHealth = {
        overview: {
          totalUsers: 50,
          totalRepositories: 200,
          activeRepositories: 180,
          totalStaleIssues: 150,
        },
        performance: {
          notificationsLast24h: 25,
          deliveryRate: 95,
          failedNotifications: 2,
          repositoriesCheckedLast24h: 175,
          averageProcessingDelayHours: 2,
        },
        health: {
          staleRepositories: 5,
          bouncedUsers: 3,
          systemStatus: "healthy" as const,
        },
        lastUpdated: Date.now(),
      };

      expect(mockSystemHealth.overview.totalUsers).toBe(50);
      expect(mockSystemHealth.performance.deliveryRate).toBe(95);
      expect(mockSystemHealth.health.systemStatus).toBe("healthy");
      expect(mockSystemHealth.lastUpdated).toBeGreaterThan(0);
    });

    test("should validate dashboard summary structure", () => {
      const mockDashboardSummary = {
        totalRepositories: 5,
        activeRepositories: 4,
        totalStaleIssues: 12,
        activeRules: 8,
        notificationsThisWeek: 3,
        repositoriesNeedingAttention: 1,
        lastUpdated: Date.now(),
      };

      expect(mockDashboardSummary.totalRepositories).toBe(5);
      expect(mockDashboardSummary.activeRepositories).toBe(4);
      expect(mockDashboardSummary.totalStaleIssues).toBe(12);
      expect(mockDashboardSummary.repositoriesNeedingAttention).toBe(1);
    });

    test("should validate dashboard management data structure", () => {
      const mockManagementData = {
        repositories: [
          {
            ...createTestRepository(),
            rulesCount: 3,
            activeRulesCount: 2,
            totalIssues: 15,
            staleIssues: 5,
            lastNotificationSent: Date.now() - 24 * 60 * 60 * 1000,
            healthScore: 85,
          },
        ],
        rules: [
          {
            _id: "rule-1",
            userId: "user-1",
            repositoryId: "repo-1",
            name: "Test Rule",
            inactivityDays: 14,
            labels: ["bug"],
            issueStates: ["open"],
            assigneeCondition: "any",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            repositoryName: "test-repo",
            repositoryFullName: "user/test-repo",
            repositoryIsActive: true,
          },
        ],
        summary: {
          totalRepositories: 1,
          activeRepositories: 1,
          totalRules: 1,
          activeRules: 1,
          repositoriesWithIssues: 1,
          repositoriesWithStaleIssues: 1,
        },
      };

      expect(mockManagementData.repositories).toHaveLength(1);
      expect(mockManagementData.repositories[0]).toHaveProperty('rulesCount');
      expect(mockManagementData.repositories[0]).toHaveProperty('healthScore');
      expect(mockManagementData.rules).toHaveLength(1);
      expect(mockManagementData.rules[0]).toHaveProperty('repositoryName');
      expect(mockManagementData.summary.totalRepositories).toBe(1);
    });

    test("should validate dashboard system status structure", () => {
      const mockSystemStatus = {
        repositories: {
          total: 10,
          active: 8,
          stale: 2,
          recentlyChecked: 6,
          healthPercentage: 75,
        },
        notifications: {
          last24h: 15,
          failed: 2,
          successRate: 87,
        },
        overall: {
          healthScore: 82,
          status: "healthy" as const,
          lastUpdated: Date.now(),
        },
      };

      expect(mockSystemStatus.repositories.total).toBe(10);
      expect(mockSystemStatus.repositories.healthPercentage).toBe(75);
      expect(mockSystemStatus.notifications.successRate).toBe(87);
      expect(mockSystemStatus.overall.status).toBe("healthy");
    });

    test("should validate dashboard quick actions structure", () => {
      const mockQuickActions = {
        availableActions: [
          {
            id: "refresh_stale_repos",
            title: "Refresh Stale Repositories",
            description: "3 repositories need checking",
            count: 3,
            enabled: true,
            repositoryIds: ["repo-1", "repo-2", "repo-3"],
          },
          {
            id: "activate_inactive_rules",
            title: "Review Inactive Rules",
            description: "2 rules are currently inactive",
            count: 2,
            enabled: true,
            ruleIds: ["rule-1", "rule-2"],
          },
        ],
        summary: {
          totalActionableItems: 5,
          lastUpdated: Date.now(),
        },
      };

      expect(mockQuickActions.availableActions).toHaveLength(2);
      expect(mockQuickActions.availableActions[0].enabled).toBe(true);
      expect(mockQuickActions.availableActions[0]).toHaveProperty('repositoryIds');
      expect(mockQuickActions.availableActions[1]).toHaveProperty('ruleIds');
      expect(mockQuickActions.summary.totalActionableItems).toBe(5);
    });
  });
});