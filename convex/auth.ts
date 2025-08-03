import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { encryptToken, decryptToken } from "./lib/encryption";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
});

/**
 * Get the current authenticated user's profile
 */
export const getCurrentUser = query({
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
    
    // Don't return sensitive data like tokens
    return {
      _id: user._id,
      githubId: user.githubId,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      repositories: user.repositories || [],
      notificationPreferences: user.notificationPreferences,
      createdAt: user.createdAt,
      lastActive: user.lastActive,
    };
  },
});

/**
 * Sign in with GitHub and create/update user profile
 */
export const signInWithGitHub = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get the user's GitHub profile from the auth session
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("No identity found");
    }

    const githubProfile = identity.tokenIdentifier;
    const email = identity.email;
    const name = identity.name;
    const avatarUrl = identity.pictureUrl;

    // Extract GitHub ID from the token identifier
    const githubId = githubProfile.split("|")[1];

    // Check if user already exists
    let user = await ctx.db.get(userId);
    
    if (!user) {
      // Create new user profile
      await ctx.db.insert("users", {
        githubId,
        email: email || "",
        name: name || "",
        avatarUrl: avatarUrl || "",
        accessToken: "", // Will be set separately with proper encryption
        refreshToken: "", // Will be set separately with proper encryption
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
    } else {
      // Update existing user profile
      await ctx.db.patch(userId, {
        email: email || user.email,
        name: name || user.name,
        avatarUrl: avatarUrl || user.avatarUrl,
        lastActive: Date.now(),
      });
    }

    return { success: true };
  },
});

/**
 * Update user profile information
 */
export const updateUserProfile = mutation({
  args: {
    notificationPreferences: v.optional(v.object({
      emailFrequency: v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly")),
      quietHours: v.object({
        start: v.number(),
        end: v.number(),
      }),
      emailTemplate: v.string(),
      pauseNotifications: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const updates: any = {
      lastActive: Date.now(),
    };

    if (args.notificationPreferences) {
      updates.notificationPreferences = args.notificationPreferences;
    }

    await ctx.db.patch(userId, updates);
    return { success: true };
  },
});

/**
 * Store encrypted GitHub access tokens
 */
export const storeGitHubTokens = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Encrypt tokens before storing
    const encryptedAccessToken = encryptToken(args.accessToken);
    const encryptedRefreshToken = args.refreshToken ? encryptToken(args.refreshToken) : "";

    await ctx.db.patch(userId, {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Refresh GitHub access token when expired
 */
export const refreshGitHubToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user || !user.refreshToken) {
      throw new Error("No refresh token available");
    }

    try {
      // Decrypt the refresh token for use
      const actualRefreshToken = decryptToken(user.refreshToken);

      // Make request to GitHub to refresh the token
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.GITHUB_CLIENT_ID!,
          client_secret: process.env.GITHUB_CLIENT_SECRET!,
          refresh_token: actualRefreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to refresh token");
      }

      const tokenData = await response.json();
      
      if (tokenData.error) {
        throw new Error(`Token refresh error: ${tokenData.error_description}`);
      }

      // Store the new encrypted tokens
      await ctx.db.patch(userId, {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : user.refreshToken,
        lastActive: Date.now(),
      });

      return { success: true, newToken: tokenData.access_token };
    } catch (error) {
      console.error("Token refresh failed:", error);
      throw new Error("Failed to refresh GitHub token");
    }
  },
});

/**
 * Check if user session is valid and tokens are not expired
 */
export const validateSession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { valid: false, reason: "not_authenticated" };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { valid: false, reason: "user_not_found" };
    }

    if (!user.accessToken) {
      return { valid: false, reason: "no_access_token" };
    }

    // In a real implementation, you would validate the token with GitHub
    // For now, we'll assume it's valid if it exists
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
 * Sign out and clear session
 */
export const signOutUser = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId) {
      // Update last active time before signing out
      await ctx.db.patch(userId, {
        lastActive: Date.now(),
      });
    }
    
    // The actual sign out is handled by the auth system
    return { success: true };
  },
});

/**
 * Get decrypted GitHub access token for API calls
 */
export const getGitHubAccessToken = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user || !user.accessToken) {
      throw new Error("No GitHub access token found");
    }

    // Return decrypted token for API calls
    return decryptToken(user.accessToken);
  },
});

/**
 * Validate GitHub access token by making a test API call
 */
export const validateGitHubToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user || !user.accessToken) {
      return { valid: false, reason: "no_token" };
    }

    try {
      const token = decryptToken(user.accessToken);
      
      // Test the token by making a simple API call to GitHub
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "StaleBot/1.0",
        },
      });

      if (response.status === 401) {
        return { valid: false, reason: "token_expired" };
      }

      if (!response.ok) {
        return { valid: false, reason: "api_error" };
      }

      const userData = await response.json();
      
      // Update user profile with latest GitHub data if needed
      if (userData.login !== user.githubId) {
        await ctx.db.patch(userId, {
          githubId: userData.login,
          name: userData.name || user.name,
          avatarUrl: userData.avatar_url || user.avatarUrl,
          lastActive: Date.now(),
        });
      }

      return { valid: true, user: userData };
    } catch (error) {
      console.error("Token validation failed:", error);
      return { valid: false, reason: "validation_error" };
    }
  },
});