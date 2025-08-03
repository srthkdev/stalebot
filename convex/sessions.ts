import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

/**
 * Check if user is authenticated and return session info
 */
export const getSession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    
    if (!userId) {
      return { 
        isAuthenticated: false,
        user: null 
      };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { 
        isAuthenticated: false,
        user: null 
      };
    }

    return {
      isAuthenticated: true,
      user: {
        _id: user._id,
        githubId: user.githubId,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        lastActive: user.lastActive,
      }
    };
  },
});

/**
 * Update user's last active timestamp
 */
export const updateLastActive = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false };
    }

    await ctx.db.patch(userId, {
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Check if user session is still valid
 */
export const validateUserSession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    
    if (!userId) {
      return { 
        valid: false, 
        reason: "not_authenticated" 
      };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { 
        valid: false, 
        reason: "user_not_found" 
      };
    }

    // Check if user has been inactive for more than 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    if (user.lastActive < thirtyDaysAgo) {
      return { 
        valid: false, 
        reason: "session_expired" 
      };
    }

    // Check if user has GitHub access token
    if (!user.accessToken) {
      return { 
        valid: false, 
        reason: "no_github_token" 
      };
    }

    return { 
      valid: true,
      user: {
        _id: user._id,
        githubId: user.githubId,
        email: user.email,
        name: user.name,
      }
    };
  },
});

/**
 * Get user preferences for the current session
 */
export const getSessionPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      notificationPreferences: user.notificationPreferences,
      repositoryCount: user.repositories.length,
    };
  },
});

/**
 * Initialize user session after OAuth callback
 */
export const initializeSession = mutation({
  args: {
    githubUserData: v.object({
      id: v.number(),
      login: v.string(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      avatar_url: v.optional(v.string()),
    }),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const { githubUserData, accessToken, refreshToken } = args;

    // Check if user already exists by GitHub ID
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", githubUserData.login))
      .first();

    if (existingUser) {
      // Update existing user with new session data
      await ctx.db.patch(existingUser._id, {
        email: githubUserData.email || existingUser.email,
        name: githubUserData.name || existingUser.name,
        avatarUrl: githubUserData.avatar_url || existingUser.avatarUrl,
        accessToken: `encrypted:${accessToken}`,
        refreshToken: refreshToken ? `encrypted:${refreshToken}` : existingUser.refreshToken,
        lastActive: Date.now(),
      });

      return { 
        success: true, 
        userId: existingUser._id,
        isNewUser: false 
      };
    }

    // Create new user
    const newUserId = await ctx.db.insert("users", {
      githubId: githubUserData.login,
      email: githubUserData.email || "",
      name: githubUserData.name || "",
      avatarUrl: githubUserData.avatar_url || "",
      accessToken: `encrypted:${accessToken}`,
      refreshToken: refreshToken ? `encrypted:${refreshToken}` : "",
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

    return { 
      success: true, 
      userId: newUserId,
      isNewUser: true 
    };
  },
});

/**
 * Clear user session data (for logout)
 */
export const clearSession = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: true }; // Already logged out
    }

    // Update last active time before clearing session
    await ctx.db.patch(userId, {
      lastActive: Date.now(),
    });

    // Note: The actual session clearing is handled by Convex Auth
    // This function just updates the user's last active time
    return { success: true };
  },
});

/**
 * Get session activity log (for debugging/monitoring)
 */
export const getSessionActivity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      userId: user._id,
      githubId: user.githubId,
      createdAt: user.createdAt,
      lastActive: user.lastActive,
      hasGitHubToken: !!user.accessToken,
      repositoryCount: user.repositories.length,
    };
  },
});