import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { encryptToken, decryptToken } from "./lib/encryption";

/**
 * Create a new user profile after GitHub OAuth
 */
export const createUserProfile = mutation({
  args: {
    githubId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", args.githubId))
      .first();

    if (existingUser) {
      // Update existing user
      await ctx.db.patch(existingUser._id, {
        email: args.email,
        name: args.name || existingUser.name,
        avatarUrl: args.avatarUrl || existingUser.avatarUrl,
        accessToken: encryptToken(args.accessToken),
        refreshToken: args.refreshToken ? encryptToken(args.refreshToken) : existingUser.refreshToken,
        lastActive: Date.now(),
      });
      return { userId: existingUser._id, isNew: false };
    }

    // Create new user
    const newUserId = await ctx.db.insert("users", {
      githubId: args.githubId,
      email: args.email,
      name: args.name || "",
      avatarUrl: args.avatarUrl || "",
      accessToken: encryptToken(args.accessToken),
      refreshToken: args.refreshToken ? encryptToken(args.refreshToken) : "",
      repositories: [],
      notificationPreferences: {
        emailFrequency: "immediate",
        quietHours: { start: 22, end: 8 },
        emailTemplate: "default",
        pauseNotifications: false,
      },
      createdAt: Date.now(),
      lastActive: Date.now(),
    });

    return { userId: newUserId, isNew: true };
  },
});

/**
 * Get user profile by ID
 */
export const getUserProfile = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = args.userId || authUserId;
    
    if (!userId) {
      return null;
    }

    // Only allow users to access their own profile or if they're authenticated
    if (args.userId && args.userId !== authUserId) {
      throw new Error("Unauthorized access to user profile");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Return user profile without sensitive data
    return {
      _id: user._id,
      githubId: user.githubId,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      repositories: user.repositories,
      notificationPreferences: user.notificationPreferences,
      createdAt: user.createdAt,
      lastActive: user.lastActive,
    };
  },
});

/**
 * Update user notification preferences
 */
export const updateNotificationPreferences = mutation({
  args: {
    emailFrequency: v.optional(v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly"))),
    quietHours: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
    emailTemplate: v.optional(v.union(v.literal("default"), v.literal("minimal"), v.literal("detailed"))),
    pauseNotifications: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Build updated preferences object
    const updatedPreferences = {
      ...user.notificationPreferences,
      ...(args.emailFrequency && { emailFrequency: args.emailFrequency }),
      ...(args.quietHours && { quietHours: args.quietHours }),
      ...(args.emailTemplate && { emailTemplate: args.emailTemplate }),
      ...(args.pauseNotifications !== undefined && { pauseNotifications: args.pauseNotifications }),
    };

    await ctx.db.patch(userId, {
      notificationPreferences: updatedPreferences,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update user basic profile information
 */
export const updateBasicProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const updates: any = {
      lastActive: Date.now(),
    };

    if (args.name !== undefined) {
      updates.name = args.name;
    }

    if (args.email !== undefined) {
      updates.email = args.email;
    }

    await ctx.db.patch(userId, updates);
    return { success: true };
  },
});

/**
 * Add repository to user's monitoring list
 */
export const addRepositoryToUser = mutation({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Check if repository is already in the list
    if (user.repositories.includes(args.repositoryId)) {
      return { success: true, message: "Repository already in monitoring list" };
    }

    // Add repository to user's list
    await ctx.db.patch(userId, {
      repositories: [...user.repositories, args.repositoryId],
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Remove repository from user's monitoring list
 */
export const removeRepositoryFromUser = mutation({
  args: {
    repositoryId: v.id("repositories"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Remove repository from user's list
    const updatedRepositories = user.repositories.filter(
      (repoId) => repoId !== args.repositoryId
    );

    await ctx.db.patch(userId, {
      repositories: updatedRepositories,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get user's GitHub access token (decrypted)
 * This is an internal function for use by other Convex functions
 */
export const getUserGitHubToken = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    const userId = args.userId || authUserId;
    
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Only allow users to access their own tokens
    if (args.userId && args.userId !== authUserId) {
      throw new Error("Unauthorized access to user tokens");
    }

    const user = await ctx.db.get(userId);
    if (!user || !user.accessToken) {
      return null;
    }

    return decryptToken(user.accessToken);
  },
});

/**
 * Update user's GitHub tokens
 */
export const updateGitHubTokens = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const updates: any = {
      accessToken: encryptToken(args.accessToken),
      lastActive: Date.now(),
    };

    if (args.refreshToken) {
      updates.refreshToken = encryptToken(args.refreshToken);
    }

    await ctx.db.patch(userId, updates);
    return { success: true };
  },
});

/**
 * Check if user has valid GitHub access
 */
export const checkGitHubAccess = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { hasAccess: false, reason: "not_authenticated" };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { hasAccess: false, reason: "user_not_found" };
    }

    if (!user.accessToken) {
      return { hasAccess: false, reason: "no_access_token" };
    }

    // In a production environment, you might want to validate the token
    // by making a test API call to GitHub here
    return { 
      hasAccess: true, 
      githubId: user.githubId,
      email: user.email 
    };
  },
});

/**
 * Delete user account and all associated data
 */
export const deleteUserAccount = mutation({
  args: {
    confirmEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Verify email confirmation
    if (args.confirmEmail !== user.email) {
      throw new Error("Email confirmation does not match");
    }

    // Delete all user's repositories
    const userRepositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const repo of userRepositories) {
      await ctx.db.delete(repo._id);
    }

    // Delete all user's rules
    const userRules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const rule of userRules) {
      await ctx.db.delete(rule._id);
    }

    // Delete all user's notifications
    const userNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const notification of userNotifications) {
      await ctx.db.delete(notification._id);
    }

    // Finally, delete the user account
    await ctx.db.delete(userId);

    return { success: true };
  },
});

/**
 * Get user statistics
 */
export const getUserStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Count repositories
    const repositoryCount = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then(repos => repos.length);

    // Count active repositories
    const activeRepositoryCount = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect()
      .then(repos => repos.length);

    // Count rules
    const ruleCount = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then(rules => rules.length);

    // Count notifications sent in the last 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentNotificationCount = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.gte(q.field("sentAt"), thirtyDaysAgo))
      .collect()
      .then(notifications => notifications.length);

    return {
      repositoryCount,
      activeRepositoryCount,
      ruleCount,
      recentNotificationCount,
    };
  },
});