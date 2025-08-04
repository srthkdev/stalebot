import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Default notification preferences for new users
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  emailFrequency: "immediate" as const,
  quietHours: {
    start: 22, // 10 PM
    end: 8,   // 8 AM
    timezone: "UTC",
  },
  emailTemplate: "default" as const,
  pauseNotifications: false,
  bounceCount: 0,
};

// Get user's notification preferences
export const getUserPreferences = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    return user.notificationPreferences;
  },
});

// Update user's notification preferences
export const updateNotificationPreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      emailFrequency: v.optional(v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly"))),
      quietHours: v.optional(v.object({
        start: v.number(),
        end: v.number(),
        timezone: v.optional(v.string()),
      })),
      emailTemplate: v.optional(v.union(v.literal("default"), v.literal("minimal"), v.literal("detailed"))),
      pauseNotifications: v.optional(v.boolean()),
      pauseUntil: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Validate quiet hours
    if (args.preferences.quietHours) {
      const { start, end } = args.preferences.quietHours;
      if (start < 0 || start > 23 || end < 0 || end > 23) {
        throw new Error("Quiet hours must be between 0 and 23");
      }
    }

    // Validate pause until timestamp
    if (args.preferences.pauseUntil && args.preferences.pauseUntil <= Date.now()) {
      throw new Error("Pause until timestamp must be in the future");
    }

    // Merge with existing preferences
    const updatedPreferences = {
      ...user.notificationPreferences,
      ...args.preferences,
      quietHours: args.preferences.quietHours 
        ? { ...user.notificationPreferences.quietHours, ...args.preferences.quietHours }
        : user.notificationPreferences.quietHours,
    };

    await ctx.db.patch(args.userId, {
      notificationPreferences: updatedPreferences,
    });

    return updatedPreferences;
  },
});

// Pause notifications temporarily
export const pauseNotifications = mutation({
  args: {
    userId: v.id("users"),
    duration: v.optional(v.number()), // duration in milliseconds, if not provided pauses indefinitely
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const pauseUntil = args.duration ? Date.now() + args.duration : undefined;

    const updatedPreferences = {
      ...user.notificationPreferences,
      pauseNotifications: true,
      pauseUntil,
    };

    await ctx.db.patch(args.userId, {
      notificationPreferences: updatedPreferences,
    });

    return {
      paused: true,
      pauseUntil,
      message: pauseUntil 
        ? `Notifications paused until ${new Date(pauseUntil).toISOString()}`
        : "Notifications paused indefinitely",
    };
  },
});

// Resume notifications
export const resumeNotifications = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updatedPreferences = {
      ...user.notificationPreferences,
      pauseNotifications: false,
      pauseUntil: undefined,
    };

    await ctx.db.patch(args.userId, {
      notificationPreferences: updatedPreferences,
    });

    return {
      paused: false,
      message: "Notifications resumed",
    };
  },
});

// Check if notifications should be sent based on user preferences
export const shouldSendNotification = internalMutation({
  args: {
    userId: v.id("users"),
    currentTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { shouldSend: false, reason: "User not found" };
    }

    const preferences = user.notificationPreferences;
    const now = args.currentTime || Date.now();

    // Check if notifications are paused
    if (preferences.pauseNotifications) {
      // Check if temporary pause has expired
      if (preferences.pauseUntil && now > preferences.pauseUntil) {
        // Auto-resume notifications
        await ctx.db.patch(args.userId, {
          notificationPreferences: {
            ...preferences,
            pauseNotifications: false,
            pauseUntil: undefined,
          },
        });
        return { shouldSend: true, reason: "Pause expired, notifications resumed" };
      }
      return { shouldSend: false, reason: "Notifications are paused" };
    }

    // Check bounce count - pause if too many bounces
    if (preferences.bounceCount && preferences.bounceCount >= 3) {
      return { shouldSend: false, reason: "Too many email bounces" };
    }

    // Check quiet hours
    if (preferences.quietHours) {
      const timezone = preferences.quietHours.timezone || "UTC";
      const currentHour = new Date(now).toLocaleString("en-US", {
        timeZone: timezone,
        hour12: false,
        hour: "numeric",
      });
      const hour = parseInt(currentHour);

      const { start, end } = preferences.quietHours;
      
      // Handle quiet hours that span midnight
      const isInQuietHours = start > end 
        ? (hour >= start || hour < end)  // e.g., 22:00 to 08:00
        : (hour >= start && hour < end); // e.g., 08:00 to 22:00

      if (isInQuietHours) {
        return { shouldSend: false, reason: "Currently in quiet hours" };
      }
    }

    return { shouldSend: true, reason: "All checks passed" };
  },
});

// Generate unsubscribe token for user
export const generateUnsubscribeToken = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Generate a secure random token
    const token = crypto.randomUUID();

    const updatedPreferences = {
      ...user.notificationPreferences,
      unsubscribeToken: token,
    };

    await ctx.db.patch(args.userId, {
      notificationPreferences: updatedPreferences,
    });

    return token;
  },
});

// Handle unsubscribe request
export const handleUnsubscribe = internalMutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Find user by unsubscribe token
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("notificationPreferences.unsubscribeToken"), args.token))
      .first();

    if (!user) {
      throw new Error("Invalid unsubscribe token");
    }

    // Pause notifications
    const updatedPreferences = {
      ...user.notificationPreferences,
      pauseNotifications: true,
      unsubscribeToken: undefined, // Remove token after use
    };

    await ctx.db.patch(user._id, {
      notificationPreferences: updatedPreferences,
    });

    return {
      success: true,
      message: "Successfully unsubscribed from notifications",
      userEmail: user.email,
    };
  },
});

// Handle email bounce events
export const handleEmailBounce = internalMutation({
  args: {
    userId: v.id("users"),
    bounceType: v.union(v.literal("hard"), v.literal("soft")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const preferences = user.notificationPreferences;
    const bounceCount = (preferences.bounceCount || 0) + 1;

    const updatedPreferences = {
      ...preferences,
      bounceCount,
      lastBounceAt: Date.now(),
      // Pause notifications after 3 bounces or any hard bounce
      pauseNotifications: bounceCount >= 3 || args.bounceType === "hard",
    };

    await ctx.db.patch(args.userId, {
      notificationPreferences: updatedPreferences,
    });

    return {
      bounceCount,
      paused: updatedPreferences.pauseNotifications,
      message: updatedPreferences.pauseNotifications 
        ? "Notifications paused due to email bounces"
        : `Email bounce recorded (${bounceCount}/3)`,
    };
  },
});

// Get email template options
export const getEmailTemplateOptions = query({
  args: {},
  handler: async () => {
    return [
      {
        id: "default",
        name: "Default",
        description: "Rich HTML template with full issue details and styling",
        preview: "Includes issue titles, labels, assignees, and activity dates with colorful styling",
      },
      {
        id: "minimal",
        name: "Minimal",
        description: "Clean, simple template with essential information only",
        preview: "Basic issue list with titles and links, minimal styling",
      },
      {
        id: "detailed",
        name: "Detailed",
        description: "Comprehensive template with additional context and statistics",
        preview: "Includes issue descriptions, activity history, and repository statistics",
      },
    ];
  },
});

// Get notification frequency options with descriptions
export const getNotificationFrequencyOptions = query({
  args: {},
  handler: async () => {
    return [
      {
        id: "immediate",
        name: "Immediate",
        description: "Send notifications as soon as stale issues are detected",
        recommended: "For active maintainers who want to address issues quickly",
      },
      {
        id: "daily",
        name: "Daily Digest",
        description: "Send a daily summary of all stale issues",
        recommended: "For regular monitoring without overwhelming your inbox",
      },
      {
        id: "weekly",
        name: "Weekly Digest",
        description: "Send a weekly summary of all stale issues",
        recommended: "For periodic review and bulk issue management",
      },
    ];
  },
});

// Validate timezone string
export const validateTimezone = query({
  args: {
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Test if timezone is valid by creating a date with it
      new Date().toLocaleString("en-US", { timeZone: args.timezone });
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: "Invalid timezone identifier. Please use IANA timezone format (e.g., 'America/New_York')" 
      };
    }
  },
});