import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Auth tables for Convex Auth
  ...authTables,
  // User profiles and authentication data
  users: defineTable({
    githubId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessToken: v.string(), // encrypted
    refreshToken: v.string(), // encrypted
    repositories: v.array(v.id("repositories")),
    notificationPreferences: v.object({
      emailFrequency: v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly")),
      quietHours: v.object({
        start: v.number(), // hour 0-23
        end: v.number(), // hour 0-23
        timezone: v.optional(v.string()), // IANA timezone identifier
      }),
      emailTemplate: v.union(v.literal("default"), v.literal("minimal"), v.literal("detailed")),
      pauseNotifications: v.boolean(),
      pauseUntil: v.optional(v.number()), // timestamp for temporary pause
      unsubscribeToken: v.optional(v.string()), // for unsubscribe links
      bounceCount: v.optional(v.number()), // track email bounces
      lastBounceAt: v.optional(v.number()), // timestamp of last bounce
    }),
    createdAt: v.number(),
    lastActive: v.number(),
  }).index("by_github_id", ["githubId"]),

  // Monitored repositories and their configurations
  repositories: defineTable({
    userId: v.id("users"),
    githubId: v.number(),
    name: v.string(),
    fullName: v.string(), // owner/repo
    isActive: v.boolean(),
    rules: v.array(v.id("rules")),
    lastChecked: v.number(),
    lastIssueCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_github_id", ["githubId"])
    .index("by_active", ["isActive"]),

  // Stale detection rules with flexible criteria
  rules: defineTable({
    userId: v.id("users"),
    repositoryId: v.id("repositories"),
    name: v.string(),
    inactivityDays: v.number(),
    labels: v.array(v.string()), // empty array means all labels
    issueStates: v.array(v.union(v.literal("open"), v.literal("closed"))),
    assigneeCondition: v.union(
      v.literal("any"),
      v.literal("assigned"),
      v.literal("unassigned"),
      v.array(v.string()) // specific users
    ),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_repository", ["repositoryId"]),

  // Cache issue data and track staleness status
  issues: defineTable({
    repositoryId: v.id("repositories"),
    githubIssueId: v.number(),
    title: v.string(),
    url: v.string(),
    state: v.union(v.literal("open"), v.literal("closed")),
    labels: v.array(v.string()),
    assignee: v.optional(v.string()),
    lastActivity: v.number(),
    isStale: v.boolean(),
    lastNotified: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_repository", ["repositoryId"])
    .index("by_stale_status", ["repositoryId", "isStale"])
    .index("by_last_activity", ["lastActivity"]),

  // Record email notifications and delivery status
  notifications: defineTable({
    userId: v.id("users"),
    repositoryId: v.id("repositories"),
    issueIds: v.array(v.id("issues")),
    emailId: v.string(), // from Resend
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed")
    ),
    sentAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),
});