import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { 
  createRuleFormValidator, 
  updateRuleFormValidator,
  validateInactivityDays 
} from "../types/validators";

// Create a new stale detection rule
export const createRule = mutation({
  args: createRuleFormValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Validate rule configuration
    const validationResult = validateRuleConfiguration(args);
    if (!validationResult.isValid) {
      throw new Error(`Invalid rule configuration: ${validationResult.errors.join(", ")}`);
    }

    // Create the rule
    const now = Date.now();
    const ruleId = await ctx.db.insert("rules", {
      userId: user._id,
      repositoryId: args.repositoryId,
      name: args.name.trim(),
      inactivityDays: args.inactivityDays,
      labels: args.labels.map(label => label.trim()).filter(label => label.length > 0),
      issueStates: args.issueStates,
      assigneeCondition: args.assigneeCondition,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Add rule to repository's rules array
    await ctx.db.patch(args.repositoryId, {
      rules: [...repository.rules, ruleId],
    });

    return ruleId;
  },
});

// Update an existing stale detection rule
export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    updates: updateRuleFormValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get existing rule
    const existingRule = await ctx.db.get(args.ruleId);
    if (!existingRule || existingRule.userId !== user._id) {
      throw new Error("Rule not found or access denied");
    }

    // Prepare updates with validation
    const updates: any = { updatedAt: Date.now() };
    
    if (args.updates.name !== undefined) {
      updates.name = args.updates.name.trim();
      if (updates.name.length === 0) {
        throw new Error("Rule name cannot be empty");
      }
    }

    if (args.updates.inactivityDays !== undefined) {
      if (!validateInactivityDays(args.updates.inactivityDays)) {
        throw new Error("Inactivity days must be between 1 and 365");
      }
      updates.inactivityDays = args.updates.inactivityDays;
    }

    if (args.updates.labels !== undefined) {
      updates.labels = args.updates.labels.map(label => label.trim()).filter(label => label.length > 0);
    }

    if (args.updates.issueStates !== undefined) {
      if (args.updates.issueStates.length === 0) {
        throw new Error("At least one issue state must be selected");
      }
      updates.issueStates = args.updates.issueStates;
    }

    if (args.updates.assigneeCondition !== undefined) {
      updates.assigneeCondition = args.updates.assigneeCondition;
    }

    if (args.updates.isActive !== undefined) {
      updates.isActive = args.updates.isActive;
    }

    // Apply updates
    await ctx.db.patch(args.ruleId, updates);

    return args.ruleId;
  },
});

// Delete a stale detection rule
export const deleteRule = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get existing rule
    const existingRule = await ctx.db.get(args.ruleId);
    if (!existingRule || existingRule.userId !== user._id) {
      throw new Error("Rule not found or access denied");
    }

    // Remove rule from repository's rules array
    const repository = await ctx.db.get(existingRule.repositoryId);
    if (repository) {
      await ctx.db.patch(existingRule.repositoryId, {
        rules: repository.rules.filter(ruleId => ruleId !== args.ruleId),
      });
    }

    // Delete the rule
    await ctx.db.delete(args.ruleId);

    return { success: true };
  },
});

// Get all rules for a user
export const listUserRules = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get all rules for the user
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get repository information for each rule
    const rulesWithRepoInfo = await Promise.all(
      rules.map(async (rule) => {
        const repository = await ctx.db.get(rule.repositoryId);
        return {
          ...rule,
          repositoryName: repository?.name || "Unknown",
          repositoryFullName: repository?.fullName || "Unknown",
        };
      })
    );

    return rulesWithRepoInfo;
  },
});

// Get rules for a specific repository
export const listRepositoryRules = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Get all rules for the repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    return rules;
  },
});

// Get a specific rule by ID
export const getRule = query({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get the rule
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.userId !== user._id) {
      throw new Error("Rule not found or access denied");
    }

    // Get repository information
    const repository = await ctx.db.get(rule.repositoryId);

    return {
      ...rule,
      repositoryName: repository?.name || "Unknown",
      repositoryFullName: repository?.fullName || "Unknown",
    };
  },
});
// Test a rule against sample issues to preview matches
export const testRule = query({
  args: {
    repositoryId: v.id("repositories"),
    ruleConfig: createRuleFormValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Validate rule configuration
    const validationResult = validateRuleConfiguration(args.ruleConfig);
    if (!validationResult.isValid) {
      throw new Error(`Invalid rule configuration: ${validationResult.errors.join(", ")}`);
    }

    // Get recent issues from the repository (limit to 50 for testing)
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .order("desc")
      .take(50);

    // Apply the rule to test issues
    const matchingIssues = issues.filter(issue => 
      evaluateIssueAgainstRule(issue, args.ruleConfig)
    );

    return {
      totalIssuesChecked: issues.length,
      matchingIssues: matchingIssues.length,
      sampleMatches: matchingIssues.slice(0, 10).map(issue => ({
        id: issue._id,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        labels: issue.labels,
        assignee: issue.assignee,
        lastActivity: issue.lastActivity,
        daysSinceActivity: Math.floor((Date.now() - issue.lastActivity) / (24 * 60 * 60 * 1000)),
      })),
    };
  },
});

// Rule validation function
function validateRuleConfiguration(rule: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate name
  if (!rule.name || rule.name.trim().length === 0) {
    errors.push("Rule name is required");
  } else if (rule.name.trim().length > 100) {
    errors.push("Rule name must be 100 characters or less");
  }

  // Validate inactivity days
  if (!validateInactivityDays(rule.inactivityDays)) {
    errors.push("Inactivity days must be between 1 and 365");
  }

  // Validate issue states
  if (!rule.issueStates || rule.issueStates.length === 0) {
    errors.push("At least one issue state must be selected");
  } else {
    const validStates = ["open", "closed"];
    const invalidStates = rule.issueStates.filter((state: string) => !validStates.includes(state));
    if (invalidStates.length > 0) {
      errors.push(`Invalid issue states: ${invalidStates.join(", ")}`);
    }
  }

  // Validate labels (optional, but if provided should be valid)
  if (rule.labels && Array.isArray(rule.labels)) {
    const invalidLabels = rule.labels.filter((label: string) => 
      typeof label !== "string" || label.trim().length === 0
    );
    if (invalidLabels.length > 0) {
      errors.push("All labels must be non-empty strings");
    }
  }

  // Validate assignee condition
  if (!rule.assigneeCondition) {
    errors.push("Assignee condition is required");
  } else {
    const validConditions = ["any", "assigned", "unassigned"];
    if (!validConditions.includes(rule.assigneeCondition) && !Array.isArray(rule.assigneeCondition)) {
      errors.push("Invalid assignee condition");
    } else if (Array.isArray(rule.assigneeCondition)) {
      const invalidUsers = rule.assigneeCondition.filter((user: string) => 
        typeof user !== "string" || user.trim().length === 0
      );
      if (invalidUsers.length > 0) {
        errors.push("All specific assignee usernames must be non-empty strings");
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}



// Toggle rule active status
export const toggleRuleStatus = mutation({
  args: { 
    ruleId: v.id("rules"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get existing rule
    const existingRule = await ctx.db.get(args.ruleId);
    if (!existingRule || existingRule.userId !== user._id) {
      throw new Error("Rule not found or access denied");
    }

    // Update rule status
    await ctx.db.patch(args.ruleId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Duplicate an existing rule
export const duplicateRule = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get existing rule
    const existingRule = await ctx.db.get(args.ruleId);
    if (!existingRule || existingRule.userId !== user._id) {
      throw new Error("Rule not found or access denied");
    }

    // Get repository
    const repository = await ctx.db.get(existingRule.repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    // Create duplicate rule
    const now = Date.now();
    const newRuleId = await ctx.db.insert("rules", {
      userId: existingRule.userId,
      repositoryId: existingRule.repositoryId,
      name: `${existingRule.name} (Copy)`,
      inactivityDays: existingRule.inactivityDays,
      labels: existingRule.labels,
      issueStates: existingRule.issueStates,
      assigneeCondition: existingRule.assigneeCondition,
      isActive: false, // Start duplicated rules as inactive
      createdAt: now,
      updatedAt: now,
    });

    // Add rule to repository's rules array
    await ctx.db.patch(existingRule.repositoryId, {
      rules: [...repository.rules, newRuleId],
    });

    return newRuleId;
  },
});
// Stale Issue Identification Engine

// Evaluate all issues in a repository against all active rules
export const evaluateRepositoryForStaleIssues = mutation({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Get all active rules for the repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    if (rules.length === 0) {
      return {
        totalIssues: 0,
        staleIssues: 0,
        updatedIssues: [],
        message: "No active rules found for repository",
      };
    }

    // Get all issues for the repository
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    const updatedIssues: string[] = [];
    let staleCount = 0;

    // Evaluate each issue against all rules
    for (const issue of issues) {
      const wasStale = issue.isStale;
      const isNowStale = evaluateIssueAgainstMultipleRules(issue, rules);

      // Update issue if staleness status changed
      if (wasStale !== isNowStale) {
        await ctx.db.patch(issue._id, {
          isStale: isNowStale,
          updatedAt: Date.now(),
        });
        updatedIssues.push(issue._id);
      }

      if (isNowStale) {
        staleCount++;
      }
    }

    return {
      totalIssues: issues.length,
      staleIssues: staleCount,
      updatedIssues,
      rulesApplied: rules.length,
    };
  },
});

// Get all stale issues for a repository
export const getStaleIssuesForRepository = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Get all stale issues for the repository
    const staleIssues = await ctx.db
      .query("issues")
      .withIndex("by_stale_status", (q) => 
        q.eq("repositoryId", args.repositoryId).eq("isStale", true)
      )
      .collect();

    // Add calculated inactivity information
    const staleIssuesWithInactivity = staleIssues.map(issue => ({
      ...issue,
      daysSinceActivity: calculateDaysSinceActivity(issue.lastActivity),
      inactivityPeriod: formatInactivityPeriod(issue.lastActivity),
    }));

    return staleIssuesWithInactivity;
  },
});

// Get stale issues across all repositories for a user
export const getAllStaleIssuesForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Get all user's repositories
    const repositories = await ctx.db
      .query("repositories")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const allStaleIssues = [];

    // Get stale issues for each repository
    for (const repository of repositories) {
      const staleIssues = await ctx.db
        .query("issues")
        .withIndex("by_stale_status", (q) => 
          q.eq("repositoryId", repository._id).eq("isStale", true)
        )
        .collect();

      // Add repository information and inactivity data
      const issuesWithRepoInfo = staleIssues.map(issue => ({
        ...issue,
        repositoryName: repository.name,
        repositoryFullName: repository.fullName,
        daysSinceActivity: calculateDaysSinceActivity(issue.lastActivity),
        inactivityPeriod: formatInactivityPeriod(issue.lastActivity),
      }));

      allStaleIssues.push(...issuesWithRepoInfo);
    }

    // Sort by most stale first
    allStaleIssues.sort((a, b) => a.lastActivity - b.lastActivity);

    return allStaleIssues;
  },
});

// Batch evaluate multiple repositories for stale issues
export const batchEvaluateRepositories = mutation({
  args: { repositoryIds: v.array(v.id("repositories")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    const results = [];

    // Process each repository
    for (const repositoryId of args.repositoryIds) {
      try {
        // Validate repository belongs to user
        const repository = await ctx.db.get(repositoryId);
        if (!repository || repository.userId !== user._id) {
          results.push({
            repositoryId,
            success: false,
            error: "Repository not found or access denied",
          });
          continue;
        }

        // Evaluate repository
        const result = await evaluateRepositoryForStaleIssuesInternal(ctx, repositoryId);
        results.push({
          repositoryId,
          success: true,
          ...result,
        });
      } catch (error) {
        results.push({
          repositoryId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});

// Internal helper function for repository evaluation
async function evaluateRepositoryForStaleIssuesInternal(ctx: MutationCtx, repositoryId: string) {
  // Get all active rules for the repository
  const rules = await ctx.db
    .query("rules")
    .withIndex("by_repository", (q: any) => q.eq("repositoryId", repositoryId))
    .filter((q: any) => q.eq(q.field("isActive"), true))
    .collect();

  if (rules.length === 0) {
    return {
      totalIssues: 0,
      staleIssues: 0,
      updatedIssues: [],
      message: "No active rules found for repository",
    };
  }

  // Get all issues for the repository
  const issues = await ctx.db
    .query("issues")
    .withIndex("by_repository", (q: any) => q.eq("repositoryId", repositoryId))
    .collect();

  const updatedIssues: string[] = [];
  let staleCount = 0;

  // Evaluate each issue against all rules
  for (const issue of issues) {
    const wasStale = issue.isStale;
    const isNowStale = evaluateIssueAgainstMultipleRules(issue, rules);

    // Update issue if staleness status changed
    if (wasStale !== isNowStale) {
      await ctx.db.patch(issue._id, {
        isStale: isNowStale,
        updatedAt: Date.now(),
      });
      updatedIssues.push(issue._id);
    }

    if (isNowStale) {
      staleCount++;
    }
  }

  return {
    totalIssues: issues.length,
    staleIssues: staleCount,
    updatedIssues,
    rulesApplied: rules.length,
  };
}

// Enhanced rule evaluation function that handles multiple rules
function evaluateIssueAgainstMultipleRules(issue: any, rules: any[]): boolean {
  // An issue is considered stale if it matches ANY of the active rules
  return rules.some(rule => evaluateIssueAgainstRule(issue, rule));
}

// Enhanced single rule evaluation with better logic
function evaluateIssueAgainstRule(issue: any, rule: any): boolean {
  // Check inactivity period
  const daysSinceActivity = calculateDaysSinceActivity(issue.lastActivity);
  if (daysSinceActivity < rule.inactivityDays) {
    return false;
  }

  // Check issue state
  if (!rule.issueStates.includes(issue.state)) {
    return false;
  }

  // Check labels (if rule specifies labels, issue must have at least one matching label)
  if (rule.labels && rule.labels.length > 0) {
    const hasMatchingLabel = rule.labels.some((ruleLabel: string) =>
      issue.labels.some((issueLabel: string) => 
        issueLabel.toLowerCase() === ruleLabel.toLowerCase()
      )
    );
    if (!hasMatchingLabel) {
      return false;
    }
  }

  // Check assignee condition
  switch (rule.assigneeCondition) {
    case "any":
      // No assignee filtering
      break;
    case "assigned":
      if (!issue.assignee) {
        return false;
      }
      break;
    case "unassigned":
      if (issue.assignee) {
        return false;
      }
      break;
    default:
      // Specific users array
      if (Array.isArray(rule.assigneeCondition)) {
        if (!issue.assignee || !rule.assigneeCondition.includes(issue.assignee)) {
          return false;
        }
      }
      break;
  }

  return true;
}

// Utility function to calculate days since last activity
function calculateDaysSinceActivity(lastActivity: number): number {
  return Math.floor((Date.now() - lastActivity) / (24 * 60 * 60 * 1000));
}

// Utility function to format inactivity period in human-readable format
function formatInactivityPeriod(lastActivity: number): string {
  const days = calculateDaysSinceActivity(lastActivity);
  
  if (days === 0) {
    return "Today";
  } else if (days === 1) {
    return "1 day ago";
  } else if (days < 7) {
    return `${days} days ago`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  } else if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  } else {
    const years = Math.floor(days / 365);
    return years === 1 ? "1 year ago" : `${years} years ago`;
  }
}

// Get detailed stale issue analysis for a repository
export const getStaleIssueAnalysis = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get user from database
    const user = await ctx.db
      .query("users")
      .withIndex("by_github_id", (q) => q.eq("githubId", identity.subject))
      .first();
    
    if (!user) {
      throw new Error("User not found");
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      throw new Error("Repository not found or access denied");
    }

    // Get all issues and rules
    const [issues, rules] = await Promise.all([
      ctx.db
        .query("issues")
        .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
        .collect(),
      ctx.db
        .query("rules")
        .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect(),
    ]);

    // Analyze issues by staleness
    const staleIssues = issues.filter(issue => issue.isStale);
    const activeIssues = issues.filter(issue => !issue.isStale);

    // Group stale issues by inactivity period
    const stalenessBuckets = {
      "1-7 days": 0,
      "1-4 weeks": 0,
      "1-3 months": 0,
      "3-6 months": 0,
      "6+ months": 0,
    };

    staleIssues.forEach(issue => {
      const days = calculateDaysSinceActivity(issue.lastActivity);
      if (days <= 7) {
        stalenessBuckets["1-7 days"]++;
      } else if (days <= 30) {
        stalenessBuckets["1-4 weeks"]++;
      } else if (days <= 90) {
        stalenessBuckets["1-3 months"]++;
      } else if (days <= 180) {
        stalenessBuckets["3-6 months"]++;
      } else {
        stalenessBuckets["6+ months"]++;
      }
    });

    // Analyze by labels
    const labelAnalysis: Record<string, { total: number; stale: number }> = {};
    issues.forEach(issue => {
      issue.labels.forEach((label: string) => {
        if (!labelAnalysis[label]) {
          labelAnalysis[label] = { total: 0, stale: 0 };
        }
        labelAnalysis[label].total++;
        if (issue.isStale) {
          labelAnalysis[label].stale++;
        }
      });
    });

    // Analyze by assignee status
    const assigneeAnalysis = {
      assigned: { total: 0, stale: 0 },
      unassigned: { total: 0, stale: 0 },
    };

    issues.forEach(issue => {
      if (issue.assignee) {
        assigneeAnalysis.assigned.total++;
        if (issue.isStale) {
          assigneeAnalysis.assigned.stale++;
        }
      } else {
        assigneeAnalysis.unassigned.total++;
        if (issue.isStale) {
          assigneeAnalysis.unassigned.stale++;
        }
      }
    });

    return {
      summary: {
        totalIssues: issues.length,
        staleIssues: staleIssues.length,
        activeIssues: activeIssues.length,
        stalePercentage: issues.length > 0 ? Math.round((staleIssues.length / issues.length) * 100) : 0,
        activeRules: rules.length,
      },
      stalenessBuckets,
      labelAnalysis,
      assigneeAnalysis,
      oldestStaleIssue: staleIssues.length > 0 
        ? staleIssues.reduce((oldest, issue) => 
            issue.lastActivity < oldest.lastActivity ? issue : oldest
          )
        : null,
    };
  },
});