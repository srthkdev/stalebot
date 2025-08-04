import { query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "./lib/auth_helpers";

/**
 * Get notification history for the current user
 */
export const getUserNotificationHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const limit = args.limit || 20;
    
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Enrich notifications with repository data
    const enrichedNotifications = await Promise.all(
      notifications.map(async (notification) => {
        const repository = await ctx.db.get(notification.repositoryId);
        
        return {
          _id: notification._id,
          repositoryName: repository?.fullName || 'Unknown Repository',
          status: notification.status,
          sentAt: notification.sentAt,
          deliveredAt: notification.deliveredAt,
          emailId: notification.emailId,
          issueCount: notification.issueIds.length,
        };
      })
    );

    return enrichedNotifications;
  },
});