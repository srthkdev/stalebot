import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Email event handler for delivery status tracking (placeholder)
export const handleEmailEvent = internalMutation({
  args: {
    id: v.string(),
    event: v.any(),
  },
  handler: async (ctx, args) => {
    console.log("Email event received:", args.id, args.event);
    
    // Find the notification record by email ID
    const notification = await ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("emailId"), args.id))
      .first();

    if (!notification) {
      console.warn(`No notification found for email ID: ${args.id}`);
      return;
    }

    // Update notification status based on event type
    let status: "pending" | "sent" | "delivered" | "bounced" | "failed";
    let deliveredAt: number | undefined;

    switch (args.event.type) {
      case "email.sent":
        status = "sent";
        break;
      case "email.delivered":
        status = "delivered";
        deliveredAt = Date.now();
        break;
      case "email.bounced":
        status = "bounced";
        break;
      case "email.delivery_delayed":
        // Keep current status, just log the delay
        console.log(`Email delivery delayed for ${args.id}`);
        return;
      case "email.complained":
        // Handle spam complaints by pausing notifications for user
        const user = await ctx.db.get(notification.userId);
        if (user) {
          await ctx.db.patch(notification.userId, {
            notificationPreferences: {
              ...user.notificationPreferences,
              pauseNotifications: true,
            },
          });
        }
        return;
      default:
        status = "failed";
    }

    // Update the notification record
    await ctx.db.patch(notification._id, {
      status,
      ...(deliveredAt && { deliveredAt }),
    });

    console.log(`Updated notification ${notification._id} status to ${status}`);
  },
});

// Action to send email using Resend API with improved error handling and retry logic
export const sendEmailAction = internalAction({
  args: {
    notificationId: v.id("notifications"),
    from: v.optional(v.string()),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    tags: v.optional(v.array(v.object({
      name: v.string(),
      value: v.string(),
    }))),
    retryAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retryAttempt = args.retryAttempt || 1;
    const maxRetries = 3;

    try {
      // Validate required environment variable
      if (!process.env.RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY environment variable is not set");
      }

      // Validate email address format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(args.to)) {
        throw new Error(`Invalid email address: ${args.to}`);
      }

      console.log(`Sending email (attempt ${retryAttempt}/${maxRetries}) to ${args.to}: ${args.subject}`);

      // Prepare email payload
      const emailPayload = {
        from: args.from || "StaleBot <noreply@stalebot.dev>",
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        tags: args.tags?.map(tag => ({ name: tag.name, value: tag.value })) || [],
      };

      // Send email via Resend API
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        const errorMessage = `Resend API error: ${response.status} - ${JSON.stringify(errorData)}`;
        
        // Check if this is a retryable error
        const isRetryable = response.status >= 500 || response.status === 429;
        
        if (isRetryable && retryAttempt < maxRetries) {
          console.log(`Retryable error, scheduling retry ${retryAttempt + 1}/${maxRetries}`);
          
          // Schedule retry with exponential backoff
          const delayMs = Math.pow(2, retryAttempt) * 1000; // 2s, 4s, 8s
          await ctx.scheduler.runAfter(delayMs, internal.notifications.sendEmailAction, {
            ...args,
            retryAttempt: retryAttempt + 1,
          });
          
          return { id: `retry-scheduled-${retryAttempt}`, retrying: true };
        }
        
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      const emailId = result.id;
      
      if (!emailId) {
        throw new Error("No email ID returned from Resend API");
      }
      
      // Update notification status to sent
      await ctx.runMutation(internal.notifications.updateNotificationStatus, {
        notificationId: args.notificationId,
        emailId: emailId,
        status: "sent",
      });
      
      console.log(`Email sent successfully: ${emailId} (attempt ${retryAttempt})`);
      return { id: emailId, success: true, attempt: retryAttempt };
      
    } catch (error) {
      console.error(`Failed to send email (attempt ${retryAttempt}/${maxRetries}):`, error);
      
      // Only mark as failed if we've exhausted all retries
      if (retryAttempt >= maxRetries) {
        await ctx.runMutation(internal.notifications.updateNotificationStatus, {
          notificationId: args.notificationId,
          emailId: `failed-${Date.now()}`,
          status: "failed",
        });
        
        console.error(`Email permanently failed after ${maxRetries} attempts`);
      }
      
      throw error;
    }
  },
});

// Helper mutation to update notification status
export const updateNotificationStatus = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    emailId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      emailId: args.emailId,
      status: args.status,
    });
  },
});



// Email template system for stale issue notifications
export const generateStaleIssueEmailHtml = (
  repositoryName: string,
  staleIssues: Array<{
    title: string;
    url: string;
    lastActivity: number;
    labels: string[];
    assignee?: string;
  }>,
  userPreferences: {
    emailTemplate: string;
  }
): string => {
  // Input validation
  if (!repositoryName || !staleIssues || staleIssues.length === 0) {
    throw new Error("Invalid input: repositoryName and staleIssues are required");
  }

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      return "Unknown date";
    }
  };

  const formatDaysAgo = (timestamp: number) => {
    try {
      const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
      return daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
    } catch (error) {
      return "Unknown";
    }
  };

  // Escape HTML to prevent XSS
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Sort issues by last activity (oldest first)
  const sortedIssues = [...staleIssues].sort((a, b) => a.lastActivity - b.lastActivity);

  // Generate issue list HTML with better formatting
  const issueListHtml = sortedIssues
    .map((issue, index) => {
      const daysStale = Math.floor((Date.now() - issue.lastActivity) / (1000 * 60 * 60 * 24));
      const urgencyColor = daysStale > 90 ? "#dc3545" : daysStale > 30 ? "#fd7e14" : "#ffc107";
      
      return `
    <div style="border: 1px solid #e1e5e9; border-radius: 6px; padding: 16px; margin-bottom: 16px; background-color: #f6f8fa; border-left: 4px solid ${urgencyColor};">
      <div style="display: flex; justify-content: between; align-items: flex-start; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 16px; flex: 1;">
          <a href="${escapeHtml(issue.url)}" style="color: #0969da; text-decoration: none;">${escapeHtml(issue.title)}</a>
        </h3>
        <span style="background-color: ${urgencyColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; margin-left: 8px;">
          ${daysStale} days
        </span>
      </div>
      <div style="font-size: 14px; color: #656d76; margin-bottom: 8px;">
        Last activity: ${formatDate(issue.lastActivity)} (${formatDaysAgo(issue.lastActivity)})
      </div>
      ${
        issue.labels && issue.labels.length > 0
          ? `<div style="margin-bottom: 8px;">
               ${issue.labels
                 .map(
                   (label) =>
                     `<span style="background-color: #ddf4ff; color: #0969da; padding: 2px 6px; border-radius: 12px; font-size: 12px; margin-right: 4px;">${escapeHtml(label)}</span>`
                 )
                 .join("")}
             </div>`
          : ""
      }
      <div style="font-size: 14px; color: #656d76;">
        ${
          issue.assignee
            ? `👤 Assigned to: ${escapeHtml(issue.assignee)}`
            : `👤 Unassigned`
        }
      </div>
    </div>
  `;
    })
    .join("");

  // Generate summary statistics
  const totalDaysStale = sortedIssues.reduce((sum, issue) => {
    return sum + Math.floor((Date.now() - issue.lastActivity) / (1000 * 60 * 60 * 24));
  }, 0);
  const avgDaysStale = Math.round(totalDaysStale / sortedIssues.length);
  const oldestIssue = sortedIssues[0];
  const oldestDays = Math.floor((Date.now() - oldestIssue.lastActivity) / (1000 * 60 * 60 * 24));

  // Base email template with improved styling and information
  const baseTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stale Issues Found in ${escapeHtml(repositoryName)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #24292f; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 32px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white;">
    <h1 style="color: white; margin: 0; font-size: 28px;">🤖 StaleBot Report</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 16px;">Stale issues detected in ${escapeHtml(repositoryName)}</p>
  </div>
  
  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 20px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #b08800;">
      ⚠️ ${staleIssues.length} Stale Issue${staleIssues.length === 1 ? "" : "s"} Found
    </h2>
    <p style="margin: 0 0 12px 0; color: #6f4e00;">
      The following issue${staleIssues.length === 1 ? "" : "s"} in your repository ${escapeHtml(repositoryName)} ${staleIssues.length === 1 ? "has" : "have"} been inactive and may need attention.
    </p>
    <div style="display: flex; justify-content: space-between; font-size: 14px; color: #6f4e00;">
      <span>📊 Average age: ${avgDaysStale} days</span>
      <span>⏰ Oldest: ${oldestDays} days</span>
    </div>
  </div>

  <div style="margin-bottom: 32px;">
    ${issueListHtml}
  </div>

  <div style="background-color: #f6f8fa; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
    <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #24292f;">💡 Quick Actions</h3>
    <p style="margin: 0; font-size: 14px; color: #656d76;">
      Consider closing issues that are no longer relevant, or add labels like "help wanted" or "good first issue" to encourage community contributions.
    </p>
  </div>

  <div style="border-top: 1px solid #d1d9e0; padding-top: 24px; text-align: center; color: #656d76; font-size: 14px;">
    <p style="margin: 0 0 8px 0;">This email was sent by StaleBot to help you manage stale issues in your repositories.</p>
    <p style="margin: 0;">
      <a href="{{unsubscribe_url}}" style="color: #0969da; text-decoration: none;">Manage notification preferences</a> |
      <a href="{{dashboard_url}}" style="color: #0969da; text-decoration: none;">View dashboard</a>
    </p>
  </div>
</body>
</html>
  `;

  return baseTemplate;
};

// Generate plain text version of the email
export const generateStaleIssueEmailText = (
  repositoryName: string,
  staleIssues: Array<{
    title: string;
    url: string;
    lastActivity: number;
    labels: string[];
    assignee?: string;
  }>
): string => {
  // Input validation
  if (!repositoryName || !staleIssues || staleIssues.length === 0) {
    throw new Error("Invalid input: repositoryName and staleIssues are required");
  }

  const formatDate = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      return "Unknown date";
    }
  };

  const formatDaysAgo = (timestamp: number) => {
    try {
      const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
      return daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
    } catch (error) {
      return "Unknown";
    }
  };

  // Sort issues by last activity (oldest first)
  const sortedIssues = [...staleIssues].sort((a, b) => a.lastActivity - b.lastActivity);

  // Calculate summary statistics
  const totalDaysStale = sortedIssues.reduce((sum, issue) => {
    return sum + Math.floor((Date.now() - issue.lastActivity) / (1000 * 60 * 60 * 24));
  }, 0);
  const avgDaysStale = Math.round(totalDaysStale / sortedIssues.length);
  const oldestIssue = sortedIssues[0];
  const oldestDays = Math.floor((Date.now() - oldestIssue.lastActivity) / (1000 * 60 * 60 * 24));

  let text = `StaleBot Report - ${repositoryName}\n`;
  text += `${"=".repeat(50)}\n\n`;
  
  text += `${staleIssues.length} stale issue${staleIssues.length === 1 ? "" : "s"} found\n`;
  text += `Average age: ${avgDaysStale} days | Oldest: ${oldestDays} days\n\n`;

  sortedIssues.forEach((issue, index) => {
    const daysStale = Math.floor((Date.now() - issue.lastActivity) / (1000 * 60 * 60 * 24));
    const urgencyIndicator = daysStale > 90 ? "🔴" : daysStale > 30 ? "🟡" : "🟢";
    
    text += `${index + 1}. ${urgencyIndicator} ${issue.title} (${daysStale} days stale)\n`;
    text += `   URL: ${issue.url}\n`;
    text += `   Last activity: ${formatDate(issue.lastActivity)} (${formatDaysAgo(issue.lastActivity)})\n`;
    
    if (issue.labels && issue.labels.length > 0) {
      text += `   Labels: ${issue.labels.join(", ")}\n`;
    }
    
    if (issue.assignee) {
      text += `   Assigned to: ${issue.assignee}\n`;
    } else {
      text += `   Status: Unassigned\n`;
    }
    text += "\n";
  });

  text += `${"=".repeat(50)}\n`;
  text += "Quick Actions:\n";
  text += "• Close issues that are no longer relevant\n";
  text += "• Add 'help wanted' or 'good first issue' labels to encourage contributions\n";
  text += "• Update issue descriptions with current status\n\n";

  text += "---\n";
  text += "This email was sent by StaleBot to help you manage stale issues in your repositories.\n";
  text += "Visit your dashboard to manage notification preferences and view detailed analytics.\n";

  return text;
};

// Query to get notification history for a user
export const getNotificationHistory = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);

    // Enrich notifications with repository and issue data
    const enrichedNotifications = await Promise.all(
      notifications.map(async (notification) => {
        const repository = await ctx.db.get(notification.repositoryId);
        const issues = await Promise.all(
          notification.issueIds.map((issueId) => ctx.db.get(issueId))
        );

        return {
          ...notification,
          repository: repository ? {
            name: repository.name,
            fullName: repository.fullName,
          } : null,
          issues: issues.filter(Boolean).map((issue) => ({
            title: issue!.title,
            url: issue!.url,
            labels: issue!.labels,
          })),
        };
      })
    );

    return enrichedNotifications;
  },
});

// Internal query to get pending notifications for processing
export const getPendingNotifications = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

// Helper function that contains the implementation logic
async function sendStaleIssueNotificationImpl(
  ctx: any,
  args: {
    userId: Id<"users">;
    repositoryId: Id<"repositories">;
    staleIssueIds: Id<"issues">[];
  }
): Promise<Id<"notifications"> | null> {
  try {
    // Get user and repository data
    const user = await ctx.db.get(args.userId);
    const repository = await ctx.db.get(args.repositoryId);
    
    if (!user || !repository) {
      throw new Error("User or repository not found");
    }

    // Check if notifications are paused
    if (user.notificationPreferences.pauseNotifications) {
      console.log(`Notifications paused for user ${args.userId}`);
      return null;
    }

    // Get stale issues data and filter out recently notified issues
    const staleIssues = await Promise.all(
      args.staleIssueIds.map(async (issueId) => {
        const issue = await ctx.db.get(issueId);
        if (!issue) return null;
        
        // Skip issues that were notified recently (within last 24 hours)
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (issue.lastNotified && (Date.now() - issue.lastNotified) < twentyFourHours) {
          return null;
        }
        
        return {
          id: issue._id,
          title: issue.title,
          url: issue.url,
          lastActivity: issue.lastActivity,
          labels: issue.labels,
          assignee: issue.assignee,
        };
      })
    );

    const validStaleIssues = staleIssues.filter(Boolean) as NonNullable<typeof staleIssues[0]>[];
    
    if (validStaleIssues.length === 0) {
      console.log("No valid stale issues found (all recently notified)");
      return null;
    }

    // Generate email content
    const emailHtml = generateStaleIssueEmailHtml(
      repository.fullName,
      validStaleIssues,
      user.notificationPreferences
    );
    
    const emailText = generateStaleIssueEmailText(
      repository.fullName,
      validStaleIssues
    );

    // Create notification record with pending status
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      repositoryId: args.repositoryId,
      issueIds: validStaleIssues.map(issue => issue.id),
      emailId: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: "pending",
      sentAt: Date.now(),
    });

    // Schedule the email to be sent with retry logic
    await ctx.scheduler.runAfter(0, internal.notifications.sendEmailAction, {
      notificationId: notificationId,
      to: user.email,
      subject: `${validStaleIssues.length} Stale Issue${validStaleIssues.length === 1 ? "" : "s"} in ${repository.name}`,
      html: emailHtml,
      text: emailText,
      tags: [
        { name: "type", value: "stale-issues" },
        { name: "repository", value: repository.fullName },
        { name: "user", value: user.githubId },
        { name: "issue_count", value: validStaleIssues.length.toString() },
      ],
    });

    // Update issues with last notified timestamp
    await Promise.all(
      validStaleIssues.map((issue) =>
        ctx.db.patch(issue.id, {
          lastNotified: Date.now(),
        })
      )
    );

    console.log(`Scheduled stale issue notification for repository ${repository.fullName} to ${user.email} (${validStaleIssues.length} issues)`);
    return notificationId;

  } catch (error) {
    console.error("Failed to send stale issue notification:", error);
    
    // Create failed notification record for tracking
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      repositoryId: args.repositoryId,
      issueIds: args.staleIssueIds,
      emailId: `failed-${Date.now()}`,
      status: "failed",
      sentAt: Date.now(),
    });

    return notificationId;
  }
}

// Main function to send stale issue notification email
export const sendStaleIssueNotification = internalMutation({
  args: {
    userId: v.id("users"),
    repositoryId: v.id("repositories"),
    staleIssueIds: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    return await sendStaleIssueNotificationImpl(ctx, args);
  },
});

// Helper function for sending grouped notifications
async function sendGroupedNotificationsImpl(ctx: any, args: {
  userId: Id<"users">;
  repositoryNotifications: Array<{
    repositoryId: Id<"repositories">;
    staleIssueIds: Id<"issues">[];
  }>;
}): Promise<(Id<"notifications"> | null)[]> {
  const user = await ctx.db.get(args.userId);
  if (!user) {
    throw new Error("User not found");
  }

  // Check if notifications are paused
  if (user.notificationPreferences.pauseNotifications) {
    console.log(`Notifications paused for user ${args.userId}`);
    return [];
  }

  // Filter out repositories with no stale issues
  const validNotifications = args.repositoryNotifications.filter(
    notification => notification.staleIssueIds.length > 0
  );

  if (validNotifications.length === 0) {
    console.log("No valid notifications to send");
    return [];
  }

  // Check notification frequency preference
  const { emailFrequency } = user.notificationPreferences;
  
  if (emailFrequency === "immediate") {
    // Send individual notifications for each repository
    const results = [];
    for (const repoNotification of validNotifications) {
      const result = await sendStaleIssueNotificationImpl(ctx, {
        userId: args.userId,
        repositoryId: repoNotification.repositoryId,
        staleIssueIds: repoNotification.staleIssueIds,
      });
      results.push(result);
    }
    return results.filter(Boolean);
  } else {
    // For daily/weekly digest, we'll store the notifications and send them later
    return await createDigestNotificationsImpl(ctx, {
      userId: args.userId,
      repositoryNotifications: validNotifications,
      digestType: emailFrequency,
    });
  }
}

// Function to group and send notifications for multiple repositories
export const sendGroupedNotifications = internalMutation({
  args: {
    userId: v.id("users"),
    repositoryNotifications: v.array(v.object({
      repositoryId: v.id("repositories"),
      staleIssueIds: v.array(v.id("issues")),
    })),
  },
  handler: async (ctx, args) => {
    return await sendGroupedNotificationsImpl(ctx, args);
  },
});

// Helper function for creating digest notifications
async function createDigestNotificationsImpl(
  ctx: any,
  args: {
    userId: Id<"users">;
    repositoryNotifications: Array<{
      repositoryId: Id<"repositories">;
      staleIssueIds: Id<"issues">[];
    }>;
    digestType: "daily" | "weekly";
  }
): Promise<Id<"notifications">[]> {
  // Create pending notification records that will be processed by digest job
  const notificationIds = await Promise.all(
    args.repositoryNotifications.map(async (repoNotification) => {
      return await ctx.db.insert("notifications", {
        userId: args.userId,
        repositoryId: repoNotification.repositoryId,
        issueIds: repoNotification.staleIssueIds,
        emailId: `digest-${args.digestType}-${Date.now()}`,
        status: "pending",
        sentAt: Date.now(),
      });
    })
  );

  console.log(`Created ${notificationIds.length} digest notifications for user ${args.userId}`);
  return notificationIds;
}

// Function to create digest notifications (for daily/weekly emails)
export const createDigestNotifications = internalMutation({
  args: {
    userId: v.id("users"),
    repositoryNotifications: v.array(v.object({
      repositoryId: v.id("repositories"),
      staleIssueIds: v.array(v.id("issues")),
    })),
    digestType: v.union(v.literal("daily"), v.literal("weekly")),
  },
  handler: async (ctx, args) => {
    return await createDigestNotificationsImpl(ctx, args);
  },
});

// Function to send digest email (daily/weekly summary)
export const sendDigestEmail = internalMutation({
  args: {
    userId: v.id("users"),
    digestType: v.union(v.literal("daily"), v.literal("weekly")),
  },
  handler: async (ctx, args) => {
    try {
      const user = await ctx.db.get(args.userId);
      if (!user || user.notificationPreferences.pauseNotifications) {
        return null;
      }

      // Get pending digest notifications
      const pendingNotifications = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect();

      if (pendingNotifications.length === 0) {
        return null;
      }

      // Group notifications by repository
      const repositoryGroups = new Map<string, typeof pendingNotifications>();
      
      for (const notification of pendingNotifications) {
        const repoId = notification.repositoryId;
        if (!repositoryGroups.has(repoId)) {
          repositoryGroups.set(repoId, []);
        }
        repositoryGroups.get(repoId)!.push(notification);
      }

      // Generate digest email content
      let totalStaleIssues = 0;
      const repositorySummaries: Array<{
        name: string;
        fullName: string;
        issueCount: number;
        issues: Array<{
          title: string;
          url: string;
          lastActivity: number;
          labels: string[];
          assignee?: string;
        }>;
      }> = [];

      for (const [repoId, notifications] of repositoryGroups) {
        const repository = await ctx.db.get(repoId as Id<"repositories">);
        if (!repository) continue;

        const allIssueIds = notifications.flatMap(n => n.issueIds);
        const issues = await Promise.all(
          allIssueIds.map(issueId => ctx.db.get(issueId))
        );
        
        const validIssues = issues.filter(Boolean).map(issue => ({
          title: issue!.title,
          url: issue!.url,
          lastActivity: issue!.lastActivity,
          labels: issue!.labels,
          assignee: issue!.assignee,
        }));

        if (validIssues.length > 0) {
          repositorySummaries.push({
            name: repository.name,
            fullName: repository.fullName,
            issueCount: validIssues.length,
            issues: validIssues,
          });
          totalStaleIssues += validIssues.length;
        }
      }

      if (totalStaleIssues === 0) {
        return null;
      }

      // Generate digest email HTML
      const digestHtml = generateDigestEmailHtml(repositorySummaries, args.digestType);
      const digestText = generateDigestEmailText(repositorySummaries, args.digestType);

      // Create a digest notification record
      const digestNotificationId = await ctx.db.insert("notifications", {
        userId: args.userId,
        repositoryId: pendingNotifications[0].repositoryId, // Use first repo as reference
        issueIds: pendingNotifications.flatMap(n => n.issueIds),
        emailId: `digest-${args.digestType}-${Date.now()}`,
        status: "pending",
        sentAt: Date.now(),
      });

      // Schedule digest email to be sent
      await ctx.scheduler.runAfter(0, internal.notifications.sendEmailAction, {
        notificationId: digestNotificationId,
        to: user.email,
        subject: `${args.digestType.charAt(0).toUpperCase() + args.digestType.slice(1)} Digest: ${totalStaleIssues} Stale Issues Across ${repositorySummaries.length} Repositories`,
        html: digestHtml,
        text: digestText,
        tags: [
          { name: "type", value: `digest-${args.digestType}` },
          { name: "user", value: user.githubId },
          { name: "repositories", value: repositorySummaries.length.toString() },
        ],
      });

      // Mark all pending notifications as processed (they'll be updated when email is sent)
      await Promise.all(
        pendingNotifications.map(notification =>
          ctx.db.patch(notification._id, {
            status: "pending", // Will be updated to sent by the email action
          })
        )
      );

      console.log(`Scheduled ${args.digestType} digest email to ${user.email} with ${totalStaleIssues} stale issues`);
      return digestNotificationId;

    } catch (error) {
      console.error(`Failed to send ${args.digestType} digest email:`, error);
      return null;
    }
  },
});

// Generate HTML for digest emails
const generateDigestEmailHtml = (
  repositorySummaries: Array<{
    name: string;
    fullName: string;
    issueCount: number;
    issues: Array<{
      title: string;
      url: string;
      lastActivity: number;
      labels: string[];
      assignee?: string;
    }>;
  }>,
  digestType: "daily" | "weekly"
): string => {
  const totalIssues = repositorySummaries.reduce((sum, repo) => sum + repo.issueCount, 0);
  
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDaysAgo = (timestamp: number) => {
    const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    return daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
  };

  const repositoriesHtml = repositorySummaries
    .map(repo => `
      <div style="border: 1px solid #d1d9e0; border-radius: 6px; padding: 20px; margin-bottom: 24px; background-color: #f6f8fa;">
        <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #24292f;">
          📁 ${repo.fullName} (${repo.issueCount} issue${repo.issueCount === 1 ? "" : "s"})
        </h2>
        ${repo.issues.slice(0, 5).map(issue => `
          <div style="border-left: 3px solid #fd7e14; padding-left: 12px; margin-bottom: 12px;">
            <h4 style="margin: 0 0 4px 0; font-size: 16px;">
              <a href="${issue.url}" style="color: #0969da; text-decoration: none;">${issue.title}</a>
            </h4>
            <div style="font-size: 14px; color: #656d76;">
              Last activity: ${formatDate(issue.lastActivity)} (${formatDaysAgo(issue.lastActivity)})
            </div>
            ${issue.labels.length > 0 ? `
              <div style="margin-top: 4px;">
                ${issue.labels.map(label => 
                  `<span style="background-color: #ddf4ff; color: #0969da; padding: 2px 6px; border-radius: 12px; font-size: 12px; margin-right: 4px;">${label}</span>`
                ).join("")}
              </div>
            ` : ""}
          </div>
        `).join("")}
        ${repo.issues.length > 5 ? `
          <div style="font-size: 14px; color: #656d76; font-style: italic;">
            ... and ${repo.issues.length - 5} more issue${repo.issues.length - 5 === 1 ? "" : "s"}
          </div>
        ` : ""}
      </div>
    `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${digestType.charAt(0).toUpperCase() + digestType.slice(1)} StaleBot Digest</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #24292f; max-width: 700px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #24292f; margin: 0; font-size: 28px;">🤖 StaleBot ${digestType.charAt(0).toUpperCase() + digestType.slice(1)} Digest</h1>
    <p style="color: #656d76; margin: 8px 0 0 0; font-size: 18px;">Your ${digestType} summary of stale issues</p>
  </div>
  
  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 20px; margin-bottom: 32px; text-align: center;">
    <h2 style="margin: 0 0 8px 0; font-size: 24px; color: #b08800;">
      📊 ${totalIssues} Total Stale Issue${totalIssues === 1 ? "" : "s"}
    </h2>
    <p style="margin: 0; color: #6f4e00; font-size: 16px;">
      Across ${repositorySummaries.length} repositor${repositorySummaries.length === 1 ? "y" : "ies"}
    </p>
  </div>

  <div style="margin-bottom: 32px;">
    ${repositoriesHtml}
  </div>

  <div style="border-top: 1px solid #d1d9e0; padding-top: 24px; text-align: center; color: #656d76; font-size: 14px;">
    <p>This ${digestType} digest was sent by StaleBot to help you manage stale issues across your repositories.</p>
    <p>
      <a href="{{unsubscribe_url}}" style="color: #0969da; text-decoration: none;">Manage notification preferences</a> |
      <a href="{{dashboard_url}}" style="color: #0969da; text-decoration: none;">View dashboard</a>
    </p>
  </div>
</body>
</html>
  `;
};

// Generate plain text for digest emails
const generateDigestEmailText = (
  repositorySummaries: Array<{
    name: string;
    fullName: string;
    issueCount: number;
    issues: Array<{
      title: string;
      url: string;
      lastActivity: number;
      labels: string[];
      assignee?: string;
    }>;
  }>,
  digestType: "daily" | "weekly"
): string => {
  const totalIssues = repositorySummaries.reduce((sum, repo) => sum + repo.issueCount, 0);
  
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDaysAgo = (timestamp: number) => {
    const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    return daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
  };

  let text = `StaleBot ${digestType.charAt(0).toUpperCase() + digestType.slice(1)} Digest\n\n`;
  text += `${totalIssues} total stale issue${totalIssues === 1 ? "" : "s"} across ${repositorySummaries.length} repositor${repositorySummaries.length === 1 ? "y" : "ies"}:\n\n`;

  repositorySummaries.forEach((repo, repoIndex) => {
    text += `${repoIndex + 1}. ${repo.fullName} (${repo.issueCount} issue${repo.issueCount === 1 ? "" : "s"})\n`;
    
    repo.issues.slice(0, 5).forEach((issue, issueIndex) => {
      text += `   ${issueIndex + 1}. ${issue.title}\n`;
      text += `      URL: ${issue.url}\n`;
      text += `      Last activity: ${formatDate(issue.lastActivity)} (${formatDaysAgo(issue.lastActivity)})\n`;
      if (issue.labels.length > 0) {
        text += `      Labels: ${issue.labels.join(", ")}\n`;
      }
      text += "\n";
    });

    if (repo.issues.length > 5) {
      text += `   ... and ${repo.issues.length - 5} more issue${repo.issues.length - 5 === 1 ? "" : "s"}\n`;
    }
    text += "\n";
  });

  text += "---\n";
  text += `This ${digestType} digest was sent by StaleBot to help you manage stale issues across your repositories.\n`;
  text += "Visit your dashboard to manage notification preferences.\n";

  return text;
};

// Function to process stale issues and send notifications (called by processor)
export const processStaleIssuesForNotification = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
    staleIssueIds: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    try {
      // Get repository and user information
      const repository = await ctx.db.get(args.repositoryId);
      if (!repository) {
        console.error(`Repository ${args.repositoryId} not found`);
        return null;
      }

      const user = await ctx.db.get(repository.userId);
      if (!user) {
        console.error(`User ${repository.userId} not found for repository ${repository.fullName}`);
        return null;
      }

      // Check if there are any stale issues to notify about
      if (args.staleIssueIds.length === 0) {
        console.log(`No stale issues to notify for repository ${repository.fullName}`);
        return null;
      }

      console.log(`Processing ${args.staleIssueIds.length} stale issues for notification in ${repository.fullName}`);

      // Send notification based on user preferences
      const { emailFrequency } = user.notificationPreferences;
      
      if (emailFrequency === "immediate") {
        // Send immediate notification
        return await sendStaleIssueNotificationImpl(ctx, {
          userId: repository.userId,
          repositoryId: args.repositoryId,
          staleIssueIds: args.staleIssueIds,
        });
      } else {
        // Store for digest processing
        return await createDigestNotificationsImpl(ctx, {
          userId: repository.userId,
          repositoryNotifications: [{
            repositoryId: args.repositoryId,
            staleIssueIds: args.staleIssueIds,
          }],
          digestType: emailFrequency,
        });
      }

    } catch (error) {
      console.error("Error processing stale issues for notification:", error);
      return null;
    }
  },
});

// Function to consolidate multiple issues per repository into a single notification
export const consolidateRepositoryNotifications = internalMutation({
  args: {
    userId: v.id("users"),
    repositoryNotifications: v.array(v.object({
      repositoryId: v.id("repositories"),
      staleIssueIds: v.array(v.id("issues")),
    })),
  },
  handler: async (ctx, args) => {
    try {
      const user = await ctx.db.get(args.userId);
      if (!user || user.notificationPreferences.pauseNotifications) {
        return [];
      }

      // Group issues by repository and consolidate
      const consolidatedNotifications = new Map<string, Id<"issues">[]>();
      
      for (const notification of args.repositoryNotifications) {
        const repoId = notification.repositoryId;
        if (!consolidatedNotifications.has(repoId)) {
          consolidatedNotifications.set(repoId, []);
        }
        consolidatedNotifications.get(repoId)!.push(...notification.staleIssueIds);
      }

      // Remove duplicates and send consolidated notifications
      const results = [];
      for (const [repositoryId, issueIds] of consolidatedNotifications) {
        const uniqueIssueIds = [...new Set(issueIds)];
        
        if (uniqueIssueIds.length > 0) {
          const result = await sendStaleIssueNotificationImpl(ctx, {
            userId: args.userId,
            repositoryId: repositoryId as Id<"repositories">,
            staleIssueIds: uniqueIssueIds,
          });
          results.push(result);
        }
      }

      return results.filter(Boolean);

    } catch (error) {
      console.error("Error consolidating repository notifications:", error);
      return [];
    }
  },
});

// Function to retry failed email notifications
export const retryFailedNotifications = internalMutation({
  args: {
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries || 3;
    
    // Get failed notifications that haven't exceeded retry limit
    const failedNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();

    const retryResults = [];

    for (const notification of failedNotifications) {
      try {
        // Attempt to resend the notification
        const result = await sendStaleIssueNotificationImpl(ctx, {
          userId: notification.userId,
          repositoryId: notification.repositoryId,
          staleIssueIds: notification.issueIds,
        });

        if (result) {
          // Mark original notification as retried (we created a new one)
          await ctx.db.patch(notification._id, {
            status: "sent", // Update to sent since retry succeeded
          });
          
          retryResults.push({ notificationId: notification._id, success: true });
        }
      } catch (error) {
        console.error(`Failed to retry notification ${notification._id}:`, error);
        retryResults.push({ 
          notificationId: notification._id, 
          success: false, 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    console.log(`Retry completed. Success: ${retryResults.filter(r => r.success).length}, Failed: ${retryResults.filter(r => !r.success).length}`);
    return retryResults;
  },
});

// Function to process notifications in bulk for multiple users/repositories
export const processBulkNotifications = internalMutation({
  args: {
    userRepositoryMap: v.array(v.object({
      userId: v.id("users"),
      repositoryNotifications: v.array(v.object({
        repositoryId: v.id("repositories"),
        staleIssueIds: v.array(v.id("issues")),
      })),
    })),
  },
  handler: async (ctx, args) => {
    const results = [];
    
    for (const userNotification of args.userRepositoryMap) {
      try {
        // Use the implementation function directly
        const result = await sendGroupedNotificationsImpl(ctx, {
          userId: userNotification.userId,
          repositoryNotifications: userNotification.repositoryNotifications,
        });
        
        results.push({
          userId: userNotification.userId,
          success: true,
          notificationIds: result,
        });
      } catch (error) {
        console.error(`Failed to process notifications for user ${userNotification.userId}:`, error);
        results.push({
          userId: userNotification.userId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});

// Function to check and prevent duplicate notifications
export const checkDuplicateNotifications = internalQuery({
  args: {
    userId: v.id("users"),
    repositoryId: v.id("repositories"),
    issueIds: v.array(v.id("issues")),
    timeWindowHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const timeWindow = args.timeWindowHours || 24;
    const cutoffTime = Date.now() - (timeWindow * 60 * 60 * 1000);

    // Check for recent notifications for the same issues
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.and(
        q.eq(q.field("repositoryId"), args.repositoryId),
        q.gt(q.field("sentAt"), cutoffTime),
        q.neq(q.field("status"), "failed")
      ))
      .collect();

    // Check if any of the issues were already notified about recently
    const recentlyNotifiedIssues = new Set();
    for (const notification of recentNotifications) {
      for (const issueId of notification.issueIds) {
        recentlyNotifiedIssues.add(issueId);
      }
    }

    const duplicateIssues = args.issueIds.filter(issueId => 
      recentlyNotifiedIssues.has(issueId)
    );

    return {
      hasDuplicates: duplicateIssues.length > 0,
      duplicateIssues,
      recentNotificationCount: recentNotifications.length,
    };
  },
});