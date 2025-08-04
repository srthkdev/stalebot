import { query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "./lib/auth_helpers";

/**
 * Get rules for a specific repository
 */
export const getRulesForRepository = query({
  args: { repositoryId: v.id("repositories") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    // Validate repository belongs to user
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.userId !== user._id) {
      return [];
    }

    // Get all rules for the repository
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_repository", (q) => q.eq("repositoryId", args.repositoryId))
      .collect();

    return rules;
  },
});