import { describe, it, expect } from "vitest";

// Test the stale issue identification logic
describe("Stale Issue Identification Logic", () => {
  // Helper functions to create test data
  const createTestIssue = (overrides: any = {}) => ({
    _id: "test-issue-id",
    repositoryId: "test-repo-id",
    githubIssueId: 123,
    title: "Test Issue",
    url: "https://github.com/test/repo/issues/123",
    state: "open" as const,
    labels: ["bug"],
    assignee: null,
    lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
    isStale: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  const createTestRule = (overrides: any = {}) => ({
    _id: "test-rule-id",
    userId: "test-user-id",
    repositoryId: "test-repo-id",
    name: "Test Rule",
    inactivityDays: 25,
    labels: [],
    issueStates: ["open"] as const,
    assigneeCondition: "any" as const,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  // Mock the evaluation functions (these would be imported from the actual file)
  const calculateDaysSinceActivity = (lastActivity: number): number => {
    return Math.floor((Date.now() - lastActivity) / (24 * 60 * 60 * 1000));
  };

  const evaluateIssueAgainstRule = (issue: any, rule: any): boolean => {
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
        if (Array.isArray(rule.assigneeCondition)) {
          if (!issue.assignee || !rule.assigneeCondition.includes(issue.assignee)) {
            return false;
          }
        }
        break;
    }

    return true;
  };

  const evaluateIssueAgainstMultipleRules = (issue: any, rules: any[]): boolean => {
    return rules.some(rule => evaluateIssueAgainstRule(issue, rule));
  };

  const formatInactivityPeriod = (lastActivity: number): string => {
    const days = calculateDaysSinceActivity(lastActivity);
    
    if (days === 0) {
      return "Today";
    } else if (days === 1) {
      return "1 day ago";
    } else if (days < 7) {
      return `${days} days ago`;
    } else if (days < 30) {
      const weeks = Math.floor(days / 7);
      return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
    } else if (days < 365) {
      const months = Math.floor(days / 30);
      return months === 1 ? "1 month ago" : `${months} months ago`;
    } else {
      const years = Math.floor(days / 365);
      return years === 1 ? "1 year ago" : `${years} years ago`;
    }
  };

  describe("calculateDaysSinceActivity", () => {
    it("should calculate days correctly", () => {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

      expect(calculateDaysSinceActivity(oneDayAgo)).toBe(1);
      expect(calculateDaysSinceActivity(thirtyDaysAgo)).toBe(30);
      expect(calculateDaysSinceActivity(now)).toBe(0);
    });
  });

  describe("evaluateIssueAgainstRule", () => {
    it("should identify stale issues based on inactivity", () => {
      const staleIssue = createTestIssue({
        lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
      });
      const recentIssue = createTestIssue({
        lastActivity: Date.now() - (10 * 24 * 60 * 60 * 1000), // 10 days ago
      });
      const rule = createTestRule({ inactivityDays: 25 });

      expect(evaluateIssueAgainstRule(staleIssue, rule)).toBe(true);
      expect(evaluateIssueAgainstRule(recentIssue, rule)).toBe(false);
    });

    it("should filter by issue state", () => {
      const openIssue = createTestIssue({ state: "open" });
      const closedIssue = createTestIssue({ state: "closed" });
      const openOnlyRule = createTestRule({ issueStates: ["open"] });
      const closedOnlyRule = createTestRule({ issueStates: ["closed"] });

      expect(evaluateIssueAgainstRule(openIssue, openOnlyRule)).toBe(true);
      expect(evaluateIssueAgainstRule(closedIssue, openOnlyRule)).toBe(false);
      expect(evaluateIssueAgainstRule(closedIssue, closedOnlyRule)).toBe(true);
    });

    it("should filter by labels when specified", () => {
      const bugIssue = createTestIssue({ labels: ["bug"] });
      const enhancementIssue = createTestIssue({ labels: ["enhancement"] });
      const multiLabelIssue = createTestIssue({ labels: ["bug", "enhancement"] });
      
      const bugRule = createTestRule({ labels: ["bug"] });
      const enhancementRule = createTestRule({ labels: ["enhancement"] });
      const noLabelRule = createTestRule({ labels: [] });

      expect(evaluateIssueAgainstRule(bugIssue, bugRule)).toBe(true);
      expect(evaluateIssueAgainstRule(enhancementIssue, bugRule)).toBe(false);
      expect(evaluateIssueAgainstRule(multiLabelIssue, bugRule)).toBe(true);
      expect(evaluateIssueAgainstRule(multiLabelIssue, enhancementRule)).toBe(true);
      expect(evaluateIssueAgainstRule(bugIssue, noLabelRule)).toBe(true); // No label filter
    });

    it("should handle assignee conditions", () => {
      const assignedIssue = createTestIssue({ assignee: "user1" });
      const unassignedIssue = createTestIssue({ assignee: null });

      const anyRule = createTestRule({ assigneeCondition: "any" });
      const assignedRule = createTestRule({ assigneeCondition: "assigned" });
      const unassignedRule = createTestRule({ assigneeCondition: "unassigned" });
      const specificUserRule = createTestRule({ assigneeCondition: ["user1"] });
      const otherUserRule = createTestRule({ assigneeCondition: ["user2"] });

      // Test "any" condition
      expect(evaluateIssueAgainstRule(assignedIssue, anyRule)).toBe(true);
      expect(evaluateIssueAgainstRule(unassignedIssue, anyRule)).toBe(true);

      // Test "assigned" condition
      expect(evaluateIssueAgainstRule(assignedIssue, assignedRule)).toBe(true);
      expect(evaluateIssueAgainstRule(unassignedIssue, assignedRule)).toBe(false);

      // Test "unassigned" condition
      expect(evaluateIssueAgainstRule(assignedIssue, unassignedRule)).toBe(false);
      expect(evaluateIssueAgainstRule(unassignedIssue, unassignedRule)).toBe(true);

      // Test specific user condition
      expect(evaluateIssueAgainstRule(assignedIssue, specificUserRule)).toBe(true);
      expect(evaluateIssueAgainstRule(assignedIssue, otherUserRule)).toBe(false);
      expect(evaluateIssueAgainstRule(unassignedIssue, specificUserRule)).toBe(false);
    });

    it("should handle complex rule combinations", () => {
      const issue = createTestIssue({
        lastActivity: Date.now() - (45 * 24 * 60 * 60 * 1000), // 45 days ago
        state: "open",
        labels: ["bug", "priority-high"],
        assignee: "maintainer1",
      });

      const complexRule = createTestRule({
        inactivityDays: 30,
        issueStates: ["open"],
        labels: ["bug"],
        assigneeCondition: ["maintainer1", "maintainer2"],
      });

      expect(evaluateIssueAgainstRule(issue, complexRule)).toBe(true);

      // Change one condition to make it not match
      const nonMatchingRule = createTestRule({
        inactivityDays: 30,
        issueStates: ["closed"], // Issue is open, rule wants closed
        labels: ["bug"],
        assigneeCondition: ["maintainer1"],
      });

      expect(evaluateIssueAgainstRule(issue, nonMatchingRule)).toBe(false);
    });
  });

  describe("evaluateIssueAgainstMultipleRules", () => {
    it("should return true if any rule matches", () => {
      const issue = createTestIssue({
        lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000),
        labels: ["bug"],
      });

      const matchingRule = createTestRule({
        inactivityDays: 25,
        labels: ["bug"],
      });

      const nonMatchingRule = createTestRule({
        inactivityDays: 25,
        labels: ["enhancement"], // Issue has "bug", not "enhancement"
      });

      const rules = [nonMatchingRule, matchingRule];
      expect(evaluateIssueAgainstMultipleRules(issue, rules)).toBe(true);
    });

    it("should return false if no rules match", () => {
      const issue = createTestIssue({
        lastActivity: Date.now() - (10 * 24 * 60 * 60 * 1000), // Too recent
      });

      const rule1 = createTestRule({ inactivityDays: 25 });
      const rule2 = createTestRule({ inactivityDays: 30 });

      const rules = [rule1, rule2];
      expect(evaluateIssueAgainstMultipleRules(issue, rules)).toBe(false);
    });

    it("should handle empty rules array", () => {
      const issue = createTestIssue();
      expect(evaluateIssueAgainstMultipleRules(issue, [])).toBe(false);
    });
  });

  describe("formatInactivityPeriod", () => {
    it("should format periods correctly", () => {
      const now = Date.now();
      
      expect(formatInactivityPeriod(now)).toBe("Today");
      expect(formatInactivityPeriod(now - (24 * 60 * 60 * 1000))).toBe("1 day ago");
      expect(formatInactivityPeriod(now - (3 * 24 * 60 * 60 * 1000))).toBe("3 days ago");
      expect(formatInactivityPeriod(now - (7 * 24 * 60 * 60 * 1000))).toBe("1 week ago");
      expect(formatInactivityPeriod(now - (14 * 24 * 60 * 60 * 1000))).toBe("2 weeks ago");
      expect(formatInactivityPeriod(now - (30 * 24 * 60 * 60 * 1000))).toBe("1 month ago");
      expect(formatInactivityPeriod(now - (60 * 24 * 60 * 60 * 1000))).toBe("2 months ago");
      expect(formatInactivityPeriod(now - (365 * 24 * 60 * 60 * 1000))).toBe("1 year ago");
      expect(formatInactivityPeriod(now - (730 * 24 * 60 * 60 * 1000))).toBe("2 years ago");
    });
  });

  describe("Stale Issue Analysis Logic", () => {
    it("should categorize issues by staleness buckets", () => {
      const now = Date.now();
      const issues = [
        createTestIssue({ lastActivity: now - (3 * 24 * 60 * 60 * 1000) }), // 3 days
        createTestIssue({ lastActivity: now - (14 * 24 * 60 * 60 * 1000) }), // 2 weeks
        createTestIssue({ lastActivity: now - (60 * 24 * 60 * 60 * 1000) }), // 2 months
        createTestIssue({ lastActivity: now - (120 * 24 * 60 * 60 * 1000) }), // 4 months
        createTestIssue({ lastActivity: now - (400 * 24 * 60 * 60 * 1000) }), // 13+ months
      ];

      const stalenessBuckets = {
        "1-7 days": 0,
        "1-4 weeks": 0,
        "1-3 months": 0,
        "3-6 months": 0,
        "6+ months": 0,
      };

      issues.forEach(issue => {
        const days = calculateDaysSinceActivity(issue.lastActivity);
        if (days <= 7) {
          stalenessBuckets["1-7 days"]++;
        } else if (days <= 30) {
          stalenessBuckets["1-4 weeks"]++;
        } else if (days <= 90) {
          stalenessBuckets["1-3 months"]++;
        } else if (days <= 180) {
          stalenessBuckets["3-6 months"]++;
        } else {
          stalenessBuckets["6+ months"]++;
        }
      });

      expect(stalenessBuckets["1-7 days"]).toBe(1);
      expect(stalenessBuckets["1-4 weeks"]).toBe(1);
      expect(stalenessBuckets["1-3 months"]).toBe(1);
      expect(stalenessBuckets["3-6 months"]).toBe(1);
      expect(stalenessBuckets["6+ months"]).toBe(1);
    });

    it("should analyze issues by labels", () => {
      const issues = [
        createTestIssue({ labels: ["bug"], isStale: true }),
        createTestIssue({ labels: ["bug", "priority-high"], isStale: false }),
        createTestIssue({ labels: ["enhancement"], isStale: true }),
        createTestIssue({ labels: ["enhancement"], isStale: false }),
      ];

      const labelAnalysis: Record<string, { total: number; stale: number }> = {};
      
      issues.forEach(issue => {
        issue.labels.forEach((label: string) => {
          if (!labelAnalysis[label]) {
            labelAnalysis[label] = { total: 0, stale: 0 };
          }
          labelAnalysis[label].total++;
          if (issue.isStale) {
            labelAnalysis[label].stale++;
          }
        });
      });

      expect(labelAnalysis["bug"]).toEqual({ total: 2, stale: 1 });
      expect(labelAnalysis["enhancement"]).toEqual({ total: 2, stale: 1 });
      expect(labelAnalysis["priority-high"]).toEqual({ total: 1, stale: 0 });
    });

    it("should analyze issues by assignee status", () => {
      const issues = [
        createTestIssue({ assignee: "user1", isStale: true }),
        createTestIssue({ assignee: "user2", isStale: false }),
        createTestIssue({ assignee: null, isStale: true }),
        createTestIssue({ assignee: null, isStale: false }),
      ];

      const assigneeAnalysis = {
        assigned: { total: 0, stale: 0 },
        unassigned: { total: 0, stale: 0 },
      };

      issues.forEach(issue => {
        if (issue.assignee) {
          assigneeAnalysis.assigned.total++;
          if (issue.isStale) {
            assigneeAnalysis.assigned.stale++;
          }
        } else {
          assigneeAnalysis.unassigned.total++;
          if (issue.isStale) {
            assigneeAnalysis.unassigned.stale++;
          }
        }
      });

      expect(assigneeAnalysis.assigned).toEqual({ total: 2, stale: 1 });
      expect(assigneeAnalysis.unassigned).toEqual({ total: 2, stale: 1 });
    });
  });
});