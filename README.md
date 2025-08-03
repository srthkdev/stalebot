# StaleBot - GitHub Issue Janitor

StaleBot is a serverless application that monitors GitHub repositories for stale issues and sends email notifications to maintainers. Built with Convex, GitHub API, and Resend.

## Features

- GitHub OAuth authentication
- Repository monitoring and selection
- Configurable stale issue detection rules
- Automated email notifications via Resend
- User dashboard for management and monitoring

## Project Structure

```
├── convex/                 # Convex backend functions
│   ├── _generated/        # Generated Convex files
│   ├── auth.ts           # Authentication functions
│   ├── repositories.ts   # Repository management
│   ├── rules.ts          # Stale detection rules
│   ├── processor.ts      # Issue processing logic
│   ├── notifications.ts  # Email notifications
│   ├── dashboard.ts      # Dashboard functions
│   └── schema.ts         # Database schema
├── types/                 # TypeScript type definitions
├── components/            # Shared utilities
│   ├── github.ts         # GitHub API service
│   └── email.ts          # Email templates
├── convex.config.ts      # Convex configuration with Resend
└── convex.json           # Convex project settings
```

## Setup

1. Copy `.env.example` to `.env.local` and fill in your API keys:
   - GitHub OAuth app credentials
   - Resend API key

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development:
   ```bash
   npm run dev
   ```

## Environment Variables

- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app client secret
- `RESEND_API_KEY` - Resend API key for email delivery
- `CONVEX_DEPLOYMENT` - Convex deployment URL (set automatically)

## Requirements

This project implements the requirements defined in `.kiro/specs/stale-bot/requirements.md`:

- User authentication with GitHub OAuth
- Repository selection and monitoring
- Configurable stale issue detection rules
- Automated scheduled processing
- Email notifications via Resend
- User dashboard for management
- Comprehensive error handling
- Notification preferences and management