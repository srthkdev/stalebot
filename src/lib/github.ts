// GitHub API integration service
import { GitHubIssue, GitHubRepository, TokenResponse } from "../types/index";

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public rateLimitRemaining?: number,
    public rateLimitReset?: number,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public resetTime: number,
    public remaining: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class GitHubService {
  private readonly baseUrl = "https://api.github.com";
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000; // 1 second

  /**
   * Make an authenticated request to the GitHub API with retry logic and automatic token refresh
   */
  private async makeRequest<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {},
    tokenRefreshCallback?: (newToken: string) => Promise<void>
  ): Promise<T> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "StaleBot/1.0",
          ...options.headers,
        },
      });

      // Handle rate limiting
      if (response.status === 403) {
        const rateLimitRemaining = parseInt(response.headers.get("x-ratelimit-remaining") || "0");
        const rateLimitReset = parseInt(response.headers.get("x-ratelimit-reset") || "0");
        
        if (rateLimitRemaining === 0) {
          const resetTime = rateLimitReset * 1000; // Convert to milliseconds
          throw new RateLimitError(
            "GitHub API rate limit exceeded",
            resetTime,
            rateLimitRemaining
          );
        }
        
        // Check for secondary rate limits or abuse detection
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const retryAfterMs = parseInt(retryAfter) * 1000;
          throw new RateLimitError(
            "GitHub API secondary rate limit exceeded",
            Date.now() + retryAfterMs,
            0
          );
        }
      }

      // Handle authentication errors
      if (response.status === 401) {
        const errorBody = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = { message: errorBody };
        }

        throw new AuthenticationError(
          errorData.message || "GitHub token is invalid or expired"
        );
      }

      // Handle repository access errors
      if (response.status === 404) {
        const errorBody = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = { message: errorBody };
        }

        throw new GitHubApiError(
          response.status,
          "not_found",
          errorData.message || "Repository not found or access denied",
          parseInt(response.headers.get("x-ratelimit-remaining") || "0"),
          parseInt(response.headers.get("x-ratelimit-reset") || "0"),
          errorData
        );
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorBody = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorBody);
        } catch {
          errorData = { message: errorBody };
        }

        throw new GitHubApiError(
          response.status,
          errorData.code || "unknown_error",
          errorData.message || `HTTP ${response.status}`,
          parseInt(response.headers.get("x-ratelimit-remaining") || "0"),
          parseInt(response.headers.get("x-ratelimit-reset") || "0"),
          errorData
        );
      }

      return response.json();
    });
  }

  /**
   * Retry wrapper with exponential backoff and jitter
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry authentication errors
        if (error instanceof AuthenticationError) {
          throw error;
        }

        // Handle rate limit errors with proper delay
        if (error instanceof RateLimitError) {
          if (attempt === this.maxRetries) {
            throw error;
          }
          
          const now = Date.now();
          const delayUntilReset = Math.max(0, error.resetTime - now);
          const maxDelay = 60 * 60 * 1000; // 1 hour max
          const delay = Math.min(delayUntilReset + 1000, maxDelay); // Add 1 second buffer
          
          await this.delay(delay);
          continue;
        }

        // Don't retry on final attempt
        if (attempt === this.maxRetries) {
          throw error;
        }

        // Exponential backoff with jitter for other errors
        const baseDelay = this.baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * baseDelay; // 10% jitter
        const delay = baseDelay + jitter;
        
        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Utility function to create delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make a request with automatic token refresh on authentication failure
   */
  async makeRequestWithTokenRefresh<T>(
    endpoint: string,
    accessToken: string,
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    options: RequestInit = {}
  ): Promise<{
    data: T;
    newAccessToken?: string;
  }> {
    try {
      const data = await this.makeRequest<T>(endpoint, accessToken, options);
      return { data };
    } catch (error) {
      // If authentication failed, try to refresh the token
      if (error instanceof AuthenticationError) {
        console.log("Access token expired, attempting refresh...");
        
        try {
          const tokenResponse = await this.refreshAccessToken(
            refreshToken,
            clientId,
            clientSecret
          );
          
          // Retry the original request with the new token
          const data = await this.makeRequest<T>(endpoint, tokenResponse.access_token, options);
          
          return {
            data,
            newAccessToken: tokenResponse.access_token,
          };
        } catch (refreshError) {
          console.error("Token refresh failed:", refreshError);
          throw new AuthenticationError("Token refresh failed - user needs to re-authenticate");
        }
      }
      
      throw error;
    }
  }

  /**
   * Validate if the access token is still valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.makeRequest("/user", accessToken);
      return true;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return false;
      }
      // For other errors, assume token is valid but there's a temporary issue
      return true;
    }
  }

  /**
   * Refresh an expired access token using the refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    clientId?: string,
    clientSecret?: string
  ): Promise<TokenResponse> {
    if (!clientId || !clientSecret) {
      throw new AuthenticationError("Client credentials required for token refresh");
    }

    return this.withRetry(async () => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "StaleBot/1.0",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthenticationError(`Token refresh failed: HTTP ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new AuthenticationError(`Token refresh failed: ${data.error_description || data.error}`);
      }

      if (!data.access_token) {
        throw new AuthenticationError("No access token received from refresh");
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken, // GitHub may not return a new refresh token
        expires_in: data.expires_in || 3600,
        token_type: data.token_type || "bearer",
        scope: data.scope || "",
      };
    });
  }

  /**
   * Fetch a list of repositories accessible to the user
   */
  async fetchUserRepositories(
    accessToken: string,
    page = 1,
    perPage = 100
  ): Promise<GitHubRepository[]> {
    const endpoint = `/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner,collaborator`;
    return this.makeRequest<GitHubRepository[]>(endpoint, accessToken);
  }

  /**
   * Fetch issues from a specific repository
   */
  async fetchRepositoryIssues(
    accessToken: string,
    owner: string,
    repo: string,
    options: {
      state?: "open" | "closed" | "all";
      labels?: string;
      since?: string; // ISO 8601 format
      page?: number;
      perPage?: number;
    } = {}
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams();
    
    if (options.state) params.append("state", options.state);
    if (options.labels) params.append("labels", options.labels);
    if (options.since) params.append("since", options.since);
    params.append("page", (options.page || 1).toString());
    params.append("per_page", (options.perPage || 100).toString());
    params.append("sort", "updated");
    params.append("direction", "desc");

    const endpoint = `/repos/${owner}/${repo}/issues?${params.toString()}`;
    return this.makeRequest<GitHubIssue[]>(endpoint, accessToken);
  }

  /**
   * Validate if the user has access to a specific repository
   */
  async validateRepositoryAccess(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<boolean> {
    try {
      await this.makeRequest(`/repos/${owner}/${repo}`, accessToken);
      return true;
    } catch (error) {
      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 403)) {
        return false;
      }
      // For other errors, assume access is valid but there's a temporary issue
      return true;
    }
  }

  /**
   * Get repository information by ID
   */
  async getRepositoryById(
    accessToken: string,
    repoId: number
  ): Promise<GitHubRepository | null> {
    try {
      return await this.makeRequest<GitHubRepository>(`/repositories/${repoId}`, accessToken);
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get current rate limit status
   */
  async getRateLimitStatus(accessToken: string): Promise<{
    remaining: number;
    reset: number;
    limit: number;
  }> {
    const response = await this.makeRequest<{
      rate: {
        remaining: number;
        reset: number;
        limit: number;
      };
    }>("/rate_limit", accessToken);
    
    return response.rate;
  }

  /**
   * Fetch all accessible repositories for a user with pagination support
   */
  async fetchAllUserRepositories(accessToken: string): Promise<GitHubRepository[]> {
    const allRepos: GitHubRepository[] = [];
    let page = 1;
    const perPage = 100; // GitHub's max per page

    while (true) {
      const repos = await this.fetchUserRepositories(accessToken, page, perPage);
      
      if (repos.length === 0) {
        break;
      }

      allRepos.push(...repos);

      // If we got less than the full page, we're done
      if (repos.length < perPage) {
        break;
      }

      page++;
    }

    return allRepos;
  }

  /**
   * Fetch all issues from a repository with pagination support
   */
  async fetchAllRepositoryIssues(
    accessToken: string,
    owner: string,
    repo: string,
    options: {
      state?: "open" | "closed" | "all";
      labels?: string;
      since?: string; // ISO 8601 format for incremental updates
    } = {}
  ): Promise<GitHubIssue[]> {
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const issues = await this.fetchRepositoryIssues(
        accessToken,
        owner,
        repo,
        {
          ...options,
          page,
          perPage,
        }
      );

      if (issues.length === 0) {
        break;
      }

      allIssues.push(...issues);

      // If we got less than the full page, we're done
      if (issues.length < perPage) {
        break;
      }

      page++;
    }

    return allIssues;
  }

  /**
   * Fetch issues with incremental updates using the 'since' parameter
   * This is optimized for regular polling to get only recently updated issues
   */
  async fetchRecentRepositoryIssues(
    accessToken: string,
    owner: string,
    repo: string,
    since: Date,
    options: {
      state?: "open" | "closed" | "all";
      labels?: string;
    } = {}
  ): Promise<GitHubIssue[]> {
    return this.fetchAllRepositoryIssues(
      accessToken,
      owner,
      repo,
      {
        ...options,
        since: since.toISOString(),
      }
    );
  }

  /**
   * Fetch repositories with filtering options
   */
  async fetchFilteredRepositories(
    accessToken: string,
    filters: {
      type?: "owner" | "collaborator" | "organization_member";
      sort?: "created" | "updated" | "pushed" | "full_name";
      direction?: "asc" | "desc";
      affiliation?: string; // "owner,collaborator,organization_member"
    } = {}
  ): Promise<GitHubRepository[]> {
    const params = new URLSearchParams();
    
    if (filters.type) params.append("type", filters.type);
    if (filters.sort) params.append("sort", filters.sort);
    if (filters.direction) params.append("direction", filters.direction);
    if (filters.affiliation) params.append("affiliation", filters.affiliation);
    
    params.append("per_page", "100");

    const allRepos: GitHubRepository[] = [];
    let page = 1;

    while (true) {
      params.set("page", page.toString());
      const endpoint = `/user/repos?${params.toString()}`;
      const repos = await this.makeRequest<GitHubRepository[]>(endpoint, accessToken);
      
      if (repos.length === 0) {
        break;
      }

      allRepos.push(...repos);

      if (repos.length < 100) {
        break;
      }

      page++;
    }

    return allRepos;
  }

  /**
   * Batch fetch repository information for multiple repositories
   */
  async batchFetchRepositories(
    accessToken: string,
    repoIds: number[]
  ): Promise<(GitHubRepository | null)[]> {
    const results: (GitHubRepository | null)[] = [];
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < repoIds.length; i += batchSize) {
      const batch = repoIds.slice(i, i + batchSize);
      const batchPromises = batch.map(id => this.getRepositoryById(accessToken, id));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          console.error("Failed to fetch repository:", result.reason);
          results.push(null);
        }
      }

      // Add a small delay between batches to be respectful of rate limits
      if (i + batchSize < repoIds.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  /**
   * Check if a repository has been updated since a given timestamp
   */
  async hasRepositoryBeenUpdated(
    accessToken: string,
    owner: string,
    repo: string,
    since: Date
  ): Promise<boolean> {
    try {
      const repoInfo = await this.makeRequest<{
        updated_at: string;
        pushed_at: string;
      }>(`/repos/${owner}/${repo}`, accessToken);

      const lastUpdated = new Date(repoInfo.updated_at);
      const lastPushed = new Date(repoInfo.pushed_at);
      
      // Check if either the repo metadata or code has been updated
      return lastUpdated > since || lastPushed > since;
    } catch (error) {
      // If we can't check, assume it has been updated to be safe
      return true;
    }
  }

  /**
   * Fetch issues with advanced filtering and sorting
   */
  async fetchIssuesWithFilters(
    accessToken: string,
    owner: string,
    repo: string,
    filters: {
      state?: "open" | "closed" | "all";
      labels?: string[]; // Array of label names
      assignee?: string | "none" | "*"; // specific user, no assignee, or any assignee
      creator?: string;
      mentioned?: string;
      since?: Date;
      sort?: "created" | "updated" | "comments";
      direction?: "asc" | "desc";
    } = {}
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams();
    
    if (filters.state) params.append("state", filters.state);
    if (filters.labels && filters.labels.length > 0) {
      params.append("labels", filters.labels.join(","));
    }
    if (filters.assignee) params.append("assignee", filters.assignee);
    if (filters.creator) params.append("creator", filters.creator);
    if (filters.mentioned) params.append("mentioned", filters.mentioned);
    if (filters.since) params.append("since", filters.since.toISOString());
    if (filters.sort) params.append("sort", filters.sort);
    if (filters.direction) params.append("direction", filters.direction);

    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      params.set("page", page.toString());
      params.set("per_page", perPage.toString());
      
      const endpoint = `/repos/${owner}/${repo}/issues?${params.toString()}`;
      const issues = await this.makeRequest<GitHubIssue[]>(endpoint, accessToken);
      
      if (issues.length === 0) {
        break;
      }

      allIssues.push(...issues);

      if (issues.length < perPage) {
        break;
      }

      page++;
    }

    return allIssues;
  }

  /**
   * Get repository statistics and metadata
   */
  async getRepositoryStats(
    accessToken: string,
    owner: string,
    repo: string
  ): Promise<{
    openIssues: number;
    totalIssues: number;
    lastUpdated: Date;
    language: string | null;
    size: number;
    stargazersCount: number;
    forksCount: number;
  }> {
    const repoData = await this.makeRequest<{
      open_issues_count: number;
      updated_at: string;
      language: string | null;
      size: number;
      stargazers_count: number;
      forks_count: number;
    }>(`/repos/${owner}/${repo}`, accessToken);

    // Get total issues count (GitHub API doesn't provide this directly)
    // We'll estimate by fetching a small sample of closed issues
    const closedIssues = await this.fetchRepositoryIssues(
      accessToken,
      owner,
      repo,
      { state: "closed", page: 1, perPage: 1 }
    );

    return {
      openIssues: repoData.open_issues_count,
      totalIssues: repoData.open_issues_count, // This is an approximation
      lastUpdated: new Date(repoData.updated_at),
      language: repoData.language,
      size: repoData.size,
      stargazersCount: repoData.stargazers_count,
      forksCount: repoData.forks_count,
    };
  }
}