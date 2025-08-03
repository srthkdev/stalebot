// Validation schemas using Convex validators
import { v } from "convex/values";

// User validation schemas
export const notificationPreferencesValidator = v.object({
  frequency: v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly")),
  quietHours: v.optional(v.object({
    start: v.number(), // hour 0-23
    end: v.number(), // hour 0-23
  })),
  isPaused: v.boolean(),
});

export const userProfileValidator = v.object({
  githubId: v.string(),
  email: v.string(),
  accessToken: v.string(),
  refreshToken: v.string(),
  repositories: v.array(v.id("repositories")),
  notificationPreferences: notificationPreferencesValidator,
  createdAt: v.number(),
  lastActive: v.number(),
});

// Repository validation schemas
export const repositoryValidator = v.object({
  userId: v.id("users"),
  githubId: v.number(),
  name: v.string(),
  fullName: v.string(),
  isActive: v.boolean(),
  rules: v.array(v.id("rules")),
  lastChecked: v.number(),
  lastIssueCount: v.number(),
  createdAt: v.number(),
});

// Rule validation schemas
export const assigneeConditionValidator = v.union(
  v.literal("any"),
  v.literal("assigned"),
  v.literal("unassigned"),
  v.array(v.string())
);

export const staleRuleValidator = v.object({
  userId: v.id("users"),
  repositoryId: v.id("repositories"),
  name: v.string(),
  inactivityDays: v.number(),
  labels: v.array(v.string()),
  issueStates: v.array(v.union(v.literal("open"), v.literal("closed"))),
  assigneeCondition: assigneeConditionValidator,
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

// Issue validation schemas
export const trackedIssueValidator = v.object({
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
});

// Notification validation schemas
export const notificationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("failed")
);

export const notificationRecordValidator = v.object({
  userId: v.id("users"),
  repositoryId: v.id("repositories"),
  issueIds: v.array(v.id("issues")),
  emailId: v.string(),
  status: notificationStatusValidator,
  sentAt: v.number(),
  deliveredAt: v.optional(v.number()),
});

// Form data validation schemas
export const createRuleFormValidator = v.object({
  name: v.string(),
  repositoryId: v.id("repositories"),
  inactivityDays: v.number(),
  labels: v.array(v.string()),
  issueStates: v.array(v.union(v.literal("open"), v.literal("closed"))),
  assigneeCondition: assigneeConditionValidator,
});

export const updateRuleFormValidator = v.object({
  name: v.optional(v.string()),
  inactivityDays: v.optional(v.number()),
  labels: v.optional(v.array(v.string())),
  issueStates: v.optional(v.array(v.union(v.literal("open"), v.literal("closed")))),
  assigneeCondition: v.optional(assigneeConditionValidator),
  isActive: v.optional(v.boolean()),
});

export const updateNotificationPreferencesFormValidator = v.object({
  frequency: v.optional(v.union(v.literal("immediate"), v.literal("daily"), v.literal("weekly"))),
  quietHours: v.optional(v.object({
    start: v.number(),
    end: v.number(),
  })),
  isPaused: v.optional(v.boolean()),
});

export const addRepositoryFormValidator = v.object({
  githubId: v.number(),
  name: v.string(),
  fullName: v.string(),
});

// GitHub API validation schemas
export const githubIssueValidator = v.object({
  id: v.number(),
  number: v.number(),
  title: v.string(),
  html_url: v.string(),
  state: v.union(v.literal("open"), v.literal("closed")),
  labels: v.array(v.object({
    name: v.string(),
  })),
  assignee: v.optional(v.object({
    login: v.string(),
  })),
  updated_at: v.string(),
  created_at: v.string(),
});

export const githubRepositoryValidator = v.object({
  id: v.number(),
  name: v.string(),
  full_name: v.string(),
  private: v.boolean(),
  permissions: v.object({
    admin: v.boolean(),
    maintain: v.boolean(),
    push: v.boolean(),
    triage: v.boolean(),
    pull: v.boolean(),
  }),
});

// Validation helper functions
export const validateInactivityDays = (days: number): boolean => {
  return days > 0 && days <= 365; // Between 1 day and 1 year
};

export const validateQuietHours = (start: number, end: number): boolean => {
  return start >= 0 && start <= 23 && end >= 0 && end <= 23;
};

export const validateEmailAddress = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateGitHubRepoName = (fullName: string): boolean => {
  const repoNameRegex = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
  return repoNameRegex.test(fullName);
};