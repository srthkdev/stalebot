// Core type definitions for StaleBot
import { Id } from "../convex/_generated/dataModel";

export interface UserProfile {
  _id: Id<"users">;
  githubId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  accessToken: string; // encrypted
  refreshToken: string; // encrypted
  repositories: Id<"repositories">[];
  notificationPreferences: NotificationPreferences;
  createdAt: number;
  lastActive: number;
}

export interface NotificationPreferences {
  emailFrequency: "immediate" | "daily" | "weekly";
  quietHours: {
    start: number; // hour 0-23
    end: number; // hour 0-23
  };
  emailTemplate: string;
  pauseNotifications: boolean;
}

export interface Repository {
  _id: Id<"repositories">;
  userId: Id<"users">;
  githubId: number;
  name: string;
  fullName: string; // owner/repo
  isActive: boolean;
  rules: Id<"rules">[];
  lastChecked: number;
  lastIssueCount: number;
  createdAt: number;
}

export interface StaleRule {
  _id: Id<"rules">;
  userId: Id<"users">;
  repositoryId: Id<"repositories">;
  name: string;
  inactivityDays: number;
  labels: string[]; // empty array means all labels
  issueStates: ("open" | "closed")[];
  assigneeCondition: "any" | "assigned" | "unassigned" | string[]; // specific users
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TrackedIssue {
  _id: Id<"issues">;
  repositoryId: Id<"repositories">;
  githubIssueId: number;
  title: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assignee: string | null;
  lastActivity: number;
  isStale: boolean;
  lastNotified: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationRecord {
  _id: Id<"notifications">;
  userId: Id<"users">;
  repositoryId: Id<"repositories">;
  issueIds: Id<"issues">[];
  emailId: string; // from Resend
  status: "pending" | "sent" | "delivered" | "bounced" | "failed";
  sentAt: number;
  deliveredAt: number | null;
}

// GitHub API types
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  labels: Array<{
    name: string;
  }>;
  assignee: {
    login: string;
  } | null;
  updated_at: string;
  created_at: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// Utility types for API responses and form data

// Form data types for creating/updating entities
export interface CreateRuleFormData {
  name: string;
  repositoryId: Id<"repositories">;
  inactivityDays: number;
  labels: string[];
  issueStates: ("open" | "closed")[];
  assigneeCondition: "any" | "assigned" | "unassigned" | string[];
}

export interface UpdateRuleFormData extends Partial<Omit<CreateRuleFormData, "repositoryId">> {
  isActive?: boolean;
}

export interface UpdateNotificationPreferencesFormData {
  emailFrequency?: "immediate" | "daily" | "weekly";
  quietHours?: {
    start: number;
    end: number;
  };
  emailTemplate?: string;
  pauseNotifications?: boolean;
}

export interface AddRepositoryFormData {
  githubId: number;
  name: string;
  fullName: string;
}

// API response types
export interface DashboardData {
  user: UserProfile;
  repositories: Repository[];
  recentNotifications: NotificationRecord[];
  totalStaleIssues: number;
  activeRules: number;
}

export interface RepositoryWithStats extends Repository {
  staleIssueCount: number;
  totalIssueCount: number;
  lastNotificationSent?: number;
}

export interface NotificationWithDetails extends NotificationRecord {
  repositoryName: string;
  issueCount: number;
  issues: Pick<TrackedIssue, "_id" | "title" | "url" | "lastActivity">[];
}

export interface RuleWithRepository extends StaleRule {
  repositoryName: string;
  repositoryFullName: string;
}

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface RuleValidationResult extends ValidationResult {
  matchingIssuesCount?: number;
}

// GitHub API pagination types
export interface GitHubApiResponse<T> {
  data: T[];
  hasNextPage: boolean;
  nextCursor?: string;
}

// Email template data types
export interface StaleIssueEmailData {
  repositoryName: string;
  repositoryUrl: string;
  staleIssues: Array<{
    title: string;
    url: string;
    daysSinceActivity: number;
    labels: string[];
  }>;
  unsubscribeUrl: string;
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface GitHubApiErrorData extends ApiError {
  status: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

// Re-export validators for convenience
export * from "./validators";