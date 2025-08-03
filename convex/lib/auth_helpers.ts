import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { decryptToken } from "./encryption";

/**
 * Get current authenticated user (returns null if not authenticated)
 */
export async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        return null;
    }

    const user = await ctx.db.get(userId);
    return user;
}

/**
 * Get authenticated user with error handling
 */
export async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        throw new Error("Authentication required");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
        throw new Error("User not found");
    }

    return user;
}

/**
 * Get authenticated user's GitHub token
 */
export async function getAuthenticatedUserToken(ctx: QueryCtx | MutationCtx) {
    const user = await getAuthenticatedUser(ctx);

    if (!user.accessToken) {
        throw new Error("GitHub access token not found");
    }

    return decryptToken(user.accessToken);
}

/**
 * Check if user owns a repository
 */
export async function checkRepositoryOwnership(
    ctx: QueryCtx | MutationCtx,
    repositoryId: Id<"repositories">
) {
    const user = await getAuthenticatedUser(ctx);

    const repository = await ctx.db.get(repositoryId);
    if (!repository) {
        throw new Error("Repository not found");
    }

    if (repository.userId !== user._id) {
        throw new Error("Access denied: You don't own this repository");
    }

    return { user, repository };
}

/**
 * Check if user owns a rule
 */
export async function checkRuleOwnership(
    ctx: QueryCtx | MutationCtx,
    ruleId: Id<"rules">
) {
    const user = await getAuthenticatedUser(ctx);

    const rule = await ctx.db.get(ruleId);
    if (!rule) {
        throw new Error("Rule not found");
    }

    if (rule.userId !== user._id) {
        throw new Error("Access denied: You don't own this rule");
    }

    return { user, rule };
}

/**
 * Update user's last active timestamp
 */
export async function updateUserActivity(ctx: MutationCtx, userId?: Id<"users">) {
    const targetUserId = userId || await getAuthUserId(ctx);
    if (!targetUserId) {
        return;
    }

    await ctx.db.patch(targetUserId, {
        lastActive: Date.now(),
    });
}

/**
 * Validate GitHub token format
 */
export function validateGitHubTokenFormat(token: string): boolean {
    // GitHub tokens are typically 40+ characters and alphanumeric with underscores
    return token.length >= 20 && /^[a-zA-Z0-9_]+$/.test(token);
}

/**
 * Check if user is within quiet hours
 */
export function isWithinQuietHours(quietHours: { start: number; end: number }): boolean {
    const now = new Date();
    const currentHour = now.getHours();

    const { start, end } = quietHours;

    // Handle cases where quiet hours span midnight
    if (start > end) {
        return currentHour >= start || currentHour < end;
    } else {
        return currentHour >= start && currentHour < end;
    }
}

/**
 * Format user display name
 */
export function formatUserDisplayName(user: { name?: string; githubId: string; email: string }): string {
    if (user.name && user.name.trim()) {
        return user.name;
    }

    if (user.githubId) {
        return `@${user.githubId}`;
    }

    return user.email;
}

/**
 * Check if email is valid format
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Generate user avatar URL fallback
 */
export function getUserAvatarUrl(user: { avatarUrl?: string; githubId: string }): string {
    if (user.avatarUrl) {
        return user.avatarUrl;
    }

    // Fallback to GitHub avatar URL
    return `https://github.com/${user.githubId}.png`;
}

/**
 * Check if user has completed onboarding
 */
export function hasCompletedOnboarding(user: { repositories: any[]; notificationPreferences: any }): boolean {
    // User has completed onboarding if they have at least one repository
    // and their notification preferences are set
    return user.repositories.length > 0 && !!user.notificationPreferences;
}

/**
 * Get user timezone offset (placeholder - would need client-side data)
 */
export function getUserTimezoneOffset(): number {
    // This would typically come from client-side data
    // For now, return UTC offset
    return 0;
}

/**
 * Format timestamp for user's timezone
 */
export function formatTimestampForUser(timestamp: number, timezoneOffset: number = 0): string {
    const date = new Date(timestamp + (timezoneOffset * 60 * 60 * 1000));
    return date.toISOString();
}