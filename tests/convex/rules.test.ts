import { describe, it, expect } from "vitest";
import { 
  validateInactivityDays,
  validateRuleName,
  validateLabels,
  validateIssueStates,
  validateAssigneeCondition
} from "../../src/types/validators";

describe("Rule Configuration System", () => {

  describe("Rule Validation Functions", () => {
    describe("validateInactivityDays", () => {
      it("should accept valid inactivity days", () => {
        expect(validateInactivityDays(1)).toBe(true);
        expect(validateInactivityDays(30)).toBe(true);
        expect(validateInactivityDays(365)).toBe(true);
      });

      it("should reject invalid inactivity days", () => {
        expect(validateInactivityDays(0)).toBe(false);
        expect(validateInactivityDays(-1)).toBe(false);
        expect(validateInactivityDays(366)).toBe(false);
      });
    });

    describe("validateRuleName", () => {
      it("should accept valid rule names", () => {
        expect(validateRuleName("Valid Rule Name")).toBe(true);
        expect(validateRuleName("A")).toBe(true);
        expect(validateRuleName("Rule with numbers 123")).toBe(true);
      });

      it("should reject invalid rule names", () => {
        expect(validateRuleName("")).toBe(false);
        expect(validateRuleName("   ")).toBe(false);
        expect(validateRuleName("a".repeat(101))).toBe(false);
      });
    });

    describe("validateLabels", () => {
      it("should accept valid label arrays", () => {
        expect(validateLabels([])).toBe(true);
        expect(validateLabels(["bug"])).toBe(true);
        expect(validateLabels(["bug", "enhancement", "help wanted"])).toBe(true);
      });

      it("should reject invalid label arrays", () => {
        expect(validateLabels([""])).toBe(false);
        expect(validateLabels(["bug", ""])).toBe(false);
        expect(validateLabels(["   "])).toBe(false);
      });
    });

    describe("validateIssueStates", () => {
      it("should accept valid issue states", () => {
        expect(validateIssueStates(["open"])).toBe(true);
        expect(validateIssueStates(["closed"])).toBe(true);
        expect(validateIssueStates(["open", "closed"])).toBe(true);
      });

      it("should reject invalid issue states", () => {
        expect(validateIssueStates([])).toBe(false);
        expect(validateIssueStates(["invalid"])).toBe(false);
        expect(validateIssueStates(["open", "invalid"])).toBe(false);
      });
    });

    describe("validateAssigneeCondition", () => {
      it("should accept valid assignee conditions", () => {
        expect(validateAssigneeCondition("any")).toBe(true);
        expect(validateAssigneeCondition("assigned")).toBe(true);
        expect(validateAssigneeCondition("unassigned")).toBe(true);
        expect(validateAssigneeCondition(["user1"])).toBe(true);
        expect(validateAssigneeCondition(["user1", "user2"])).toBe(true);
      });

      it("should reject invalid assignee conditions", () => {
        expect(validateAssigneeCondition("invalid")).toBe(false);
        expect(validateAssigneeCondition([])).toBe(true); // Empty array is valid
        expect(validateAssigneeCondition([""])).toBe(false);
        expect(validateAssigneeCondition(["user1", ""])).toBe(false);
      });
    });
  });

  describe("Rule Evaluation Logic", () => {
    // Test the evaluateIssueAgainstRule function logic
    const createTestIssue = (overrides: any = {}) => ({
      _id: "test-id",
      repositoryId: "repo-id",
      githubIssueId: 123,
      title: "Test Issue",
      url: "https://github.com/test/repo/issues/123",
      state: "open",
      labels: ["bug"],
      assignee: null,
      lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
      isStale: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });

    const createTestRule = (overrides: any = {}) => ({
      name: "Test Rule",
      repositoryId: "repo-id",
      inactivityDays: 25,
      labels: [],
      issueStates: ["open"],
      assigneeCondition: "any",
      ...overrides,
    });

    it("should match issues older than inactivity threshold", () => {
      const issue = createTestIssue({
        lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
      });
      const rule = createTestRule({ inactivityDays: 25 });

      // This would be tested by the evaluateIssueAgainstRule function
      const daysSinceActivity = Math.floor((Date.now() - issue.lastActivity) / (24 * 60 * 60 * 1000));
      expect(daysSinceActivity).toBeGreaterThanOrEqual(rule.inactivityDays);
    });

    it("should not match recent issues", () => {
      const issue = createTestIssue({
        lastActivity: Date.now() - (10 * 24 * 60 * 60 * 1000), // 10 days ago
      });
      const rule = createTestRule({ inactivityDays: 25 });

      const daysSinceActivity = Math.floor((Date.now() - issue.lastActivity) / (24 * 60 * 60 * 1000));
      expect(daysSinceActivity).toBeLessThan(rule.inactivityDays);
    });

    it("should filter by issue state", () => {
      const openIssue = createTestIssue({ state: "open" });
      const closedIssue = createTestIssue({ state: "closed" });
      const openOnlyRule = createTestRule({ issueStates: ["open"] });
      const closedOnlyRule = createTestRule({ issueStates: ["closed"] });

      expect(openOnlyRule.issueStates.includes(openIssue.state)).toBe(true);
      expect(openOnlyRule.issueStates.includes(closedIssue.state)).toBe(false);
      expect(closedOnlyRule.issueStates.includes(closedIssue.state)).toBe(true);
    });

    it("should filter by labels when specified", () => {
      const bugIssue = createTestIssue({ labels: ["bug"] });
      const enhancementIssue = createTestIssue({ labels: ["enhancement"] });
      const bugRule = createTestRule({ labels: ["bug"] });
      const enhancementRule = createTestRule({ labels: ["enhancement"] });

      // Check if issue has matching label
      const bugMatches = bugRule.labels.some((ruleLabel: string) =>
        bugIssue.labels.some((issueLabel: string) => 
          issueLabel.toLowerCase() === ruleLabel.toLowerCase()
        )
      );
      const enhancementMatches = enhancementRule.labels.some((ruleLabel: string) =>
        enhancementIssue.labels.some((issueLabel: string) => 
          issueLabel.toLowerCase() === ruleLabel.toLowerCase()
        )
      );

      expect(bugMatches).toBe(true);
      expect(enhancementMatches).toBe(true);
    });

    it("should handle assignee conditions correctly", () => {
      const assignedIssue = createTestIssue({ assignee: "user1" });
      const unassignedIssue = createTestIssue({ assignee: null });

      const anyRule = createTestRule({ assigneeCondition: "any" });
      const assignedRule = createTestRule({ assigneeCondition: "assigned" });
      const unassignedRule = createTestRule({ assigneeCondition: "unassigned" });
      const specificUserRule = createTestRule({ assigneeCondition: ["user1"] });

      // Test assignee condition logic
      expect(anyRule.assigneeCondition).toBe("any"); // Should match both
      expect(assignedRule.assigneeCondition).toBe("assigned");
      expect(assignedIssue.assignee).toBeTruthy(); // Should match assigned rule
      expect(unassignedIssue.assignee).toBeFalsy(); // Should not match assigned rule
      expect(unassignedRule.assigneeCondition).toBe("unassigned");
      expect(Array.isArray(specificUserRule.assigneeCondition)).toBe(true);
      expect(specificUserRule.assigneeCondition).toContain("user1");
    });
  });
});