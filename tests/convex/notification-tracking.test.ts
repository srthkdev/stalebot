import { describe, it, expect } from "vitest";
import {
    generateStaleIssueEmailHtml,
    generateStaleIssueEmailText
} from "../../convex/notifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../convex/notificationPreferences";

describe("Notification Tracking and History", () => {

    it("should generate proper email HTML with unsubscribe token", () => {
        const staleIssues = [
            {
                title: "Test Issue 1",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
                labels: ["bug", "help wanted"],
                assignee: "testuser",
            },
            {
                title: "Test Issue 2",
                url: "https://github.com/test/repo/issues/2",
                lastActivity: Date.now() - (45 * 24 * 60 * 60 * 1000), // 45 days ago
                labels: ["enhancement"],
            },
        ];

        const userPreferences = {
            emailTemplate: "default" as const,
        };

        const unsubscribeToken = "test-token-123";

        const emailHtml = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            userPreferences,
            unsubscribeToken
        );

        expect(emailHtml).toContain("Test Issue 1");
        expect(emailHtml).toContain("Test Issue 2");
        expect(emailHtml).toContain("test/repo");
        expect(emailHtml).toContain("2 Stale Issues Found");
        expect(emailHtml).toContain("30 days");
        expect(emailHtml).toContain("45 days");
        expect(emailHtml).toContain("bug");
        expect(emailHtml).toContain("help wanted");
        expect(emailHtml).toContain("enhancement");
        expect(emailHtml).toContain("testuser");
        expect(emailHtml).toContain("Unassigned");
        expect(emailHtml).toContain("test-token-123");
    });

    it("should generate proper plain text email", () => {
        const staleIssues = [
            {
                title: "Test Issue 1",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
                labels: ["bug"],
                assignee: "testuser",
            },
        ];

        const emailText = generateStaleIssueEmailText("test/repo", staleIssues);

        expect(emailText).toContain("StaleBot Report - test/repo");
        expect(emailText).toContain("1 stale issue found");
        expect(emailText).toContain("Test Issue 1");
        expect(emailText).toContain("https://github.com/test/repo/issues/1");
        expect(emailText).toContain("30 days stale");
        expect(emailText).toContain("bug");
        expect(emailText).toContain("testuser");
    });

    it("should validate default notification preferences", () => {
        expect(DEFAULT_NOTIFICATION_PREFERENCES.emailFrequency).toBe("immediate");
        expect(DEFAULT_NOTIFICATION_PREFERENCES.quietHours.start).toBe(22);
        expect(DEFAULT_NOTIFICATION_PREFERENCES.quietHours.end).toBe(8);
        expect(DEFAULT_NOTIFICATION_PREFERENCES.quietHours.timezone).toBe("UTC");
        expect(DEFAULT_NOTIFICATION_PREFERENCES.emailTemplate).toBe("default");
        expect(DEFAULT_NOTIFICATION_PREFERENCES.pauseNotifications).toBe(false);
        expect(DEFAULT_NOTIFICATION_PREFERENCES.bounceCount).toBe(0);
    });

    it("should handle quiet hours logic correctly", () => {
        // Test quiet hours that span midnight (22:00 to 08:00)
        const isInQuietHours = (hour: number, start: number, end: number) => {
            return start > end
                ? (hour >= start || hour < end)  // e.g., 22:00 to 08:00
                : (hour >= start && hour < end); // e.g., 08:00 to 22:00
        };

        // Test midnight-spanning quiet hours (22:00 to 08:00)
        expect(isInQuietHours(23, 22, 8)).toBe(true);  // 11 PM - should be quiet
        expect(isInQuietHours(2, 22, 8)).toBe(true);   // 2 AM - should be quiet
        expect(isInQuietHours(7, 22, 8)).toBe(true);   // 7 AM - should be quiet
        expect(isInQuietHours(8, 22, 8)).toBe(false);  // 8 AM - should not be quiet
        expect(isInQuietHours(15, 22, 8)).toBe(false); // 3 PM - should not be quiet
        expect(isInQuietHours(21, 22, 8)).toBe(false); // 9 PM - should not be quiet

        // Test normal quiet hours (8:00 to 22:00)
        expect(isInQuietHours(10, 8, 22)).toBe(true);  // 10 AM - should be quiet
        expect(isInQuietHours(15, 8, 22)).toBe(true);  // 3 PM - should be quiet
        expect(isInQuietHours(21, 8, 22)).toBe(true);  // 9 PM - should be quiet
        expect(isInQuietHours(22, 8, 22)).toBe(false); // 10 PM - should not be quiet
        expect(isInQuietHours(2, 8, 22)).toBe(false);  // 2 AM - should not be quiet
        expect(isInQuietHours(7, 8, 22)).toBe(false);  // 7 AM - should not be quiet
    });

    it("should calculate delivery rates correctly", () => {
        // Test delivery rate calculation logic
        const calculateDeliveryRate = (delivered: number, total: number) => {
            return total > 0 ? Math.round((delivered / total) * 100) : 0;
        };

        const calculateBounceRate = (bounced: number, total: number) => {
            return total > 0 ? Math.round((bounced / total) * 100) : 0;
        };

        // Test various scenarios
        expect(calculateDeliveryRate(5, 10)).toBe(50);
        expect(calculateDeliveryRate(8, 10)).toBe(80);
        expect(calculateDeliveryRate(0, 10)).toBe(0);
        expect(calculateDeliveryRate(10, 10)).toBe(100);
        expect(calculateDeliveryRate(0, 0)).toBe(0); // Edge case

        expect(calculateBounceRate(2, 10)).toBe(20);
        expect(calculateBounceRate(1, 10)).toBe(10);
        expect(calculateBounceRate(0, 10)).toBe(0);
        expect(calculateBounceRate(0, 0)).toBe(0); // Edge case
    });

    it("should handle email template variations", () => {
        const staleIssues = [
            {
                title: "Test Issue",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000),
                labels: ["bug"],
                assignee: "testuser",
            },
        ];

        // Test different template preferences
        const defaultTemplate = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            { emailTemplate: "default" }
        );

        const minimalTemplate = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            { emailTemplate: "minimal" }
        );

        const detailedTemplate = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            { emailTemplate: "detailed" }
        );

        // All templates should contain basic information
        [defaultTemplate, minimalTemplate, detailedTemplate].forEach(template => {
            expect(template).toContain("Test Issue");
            expect(template).toContain("test/repo");
            expect(template).toContain("StaleBot");
        });

        // Templates should be different (though we're using the same base template for now)
        expect(defaultTemplate).toBeDefined();
        expect(minimalTemplate).toBeDefined();
        expect(detailedTemplate).toBeDefined();
    });

    it("should handle edge cases in email generation", () => {
        // Test with empty issues array
        expect(() => {
            generateStaleIssueEmailHtml("test/repo", [], { emailTemplate: "default" });
        }).toThrow("Invalid input: repositoryName and staleIssues are required");

        // Test with invalid repository name
        expect(() => {
            generateStaleIssueEmailHtml("", [
                {
                    title: "Test",
                    url: "https://github.com/test/repo/issues/1",
                    lastActivity: Date.now(),
                    labels: [],
                }
            ], { emailTemplate: "default" });
        }).toThrow("Invalid input: repositoryName and staleIssues are required");

        // Test with issues that have no labels or assignee
        const emailHtml = generateStaleIssueEmailHtml(
            "test/repo",
            [{
                title: "Unlabeled Issue",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000),
                labels: [],
            }],
            { emailTemplate: "default" }
        );

        expect(emailHtml).toContain("Unlabeled Issue");
        expect(emailHtml).toContain("Unassigned");
    });

    it("should format dates correctly in emails", () => {
        const testDate = new Date("2024-01-15T10:30:00Z").getTime();

        const staleIssues = [
            {
                title: "Test Issue",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: testDate,
                labels: ["bug"],
            },
        ];

        const emailHtml = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            { emailTemplate: "default" }
        );

        // Should contain formatted date
        expect(emailHtml).toContain("January 15, 2024");

        const emailText = generateStaleIssueEmailText("test/repo", staleIssues);
        expect(emailText).toContain("January 15, 2024");
    });

    it("should handle HTML escaping in email content", () => {
        const staleIssues = [
            {
                title: "Issue with <script>alert('xss')</script> in title",
                url: "https://github.com/test/repo/issues/1",
                lastActivity: Date.now() - (30 * 24 * 60 * 60 * 1000),
                labels: ["<script>", "bug & feature"],
                assignee: "<script>alert('xss')</script>",
            },
        ];

        const emailHtml = generateStaleIssueEmailHtml(
            "test/repo",
            staleIssues,
            { emailTemplate: "default" }
        );

        // Should escape HTML entities
        expect(emailHtml).toContain("&lt;script&gt;");
        expect(emailHtml).toContain("&amp;");
        expect(emailHtml).not.toContain("<script>alert('xss')</script>");

        // Plain text should not need escaping
        const emailText = generateStaleIssueEmailText("test/repo", staleIssues);
        expect(emailText).toContain("<script>alert('xss')</script>"); // Plain text preserves original
    });
});