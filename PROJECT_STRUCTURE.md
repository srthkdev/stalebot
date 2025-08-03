# Project Structure

This document outlines the organized structure of the stale-bot project.

## Directory Structure

```
stale-bot/
├── .kiro/                    # Kiro IDE configuration and specs
│   └── specs/
│       └── stale-bot/        # Feature specifications
├── convex/                   # Convex backend functions
│   ├── _generated/           # Auto-generated Convex files
│   ├── lib/                  # Convex utility functions
│   ├── auth.ts              # Authentication functions
│   ├── dashboard.ts         # Dashboard queries and mutations
│   ├── notifications.ts     # Email notification functions
│   ├── processor.ts         # Background processing functions
│   ├── repositories.ts      # Repository management functions
│   ├── rules.ts             # Stale detection rule engine
│   ├── schema.ts            # Database schema definition
│   ├── sessions.ts          # Session management
│   └── users.ts             # User management functions
├── src/                     # Source code (non-Convex)
│   ├── lib/                 # Utility libraries and services
│   │   ├── email.ts         # Email service integration
│   │   └── github.ts        # GitHub API integration
│   └── types/               # TypeScript type definitions
│       ├── index.ts         # Main type exports
│       └── validators.ts    # Validation schemas and functions
├── tests/                   # Test files
│   ├── convex/              # Tests for Convex functions
│   │   ├── rules.test.ts    # Rule configuration system tests
│   │   └── stale-identification.test.ts  # Stale issue logic tests
│   └── utils/               # Utility test helpers (empty for now)
├── package.json             # Node.js dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── vitest.config.ts         # Vitest test configuration
└── convex.config.ts         # Convex configuration
```

## Key Components

### Backend (Convex)
- **Rules Engine** (`convex/rules.ts`): Core stale detection logic with CRUD operations
- **Repository Management** (`convex/repositories.ts`): GitHub repository integration
- **Notification System** (`convex/notifications.ts`): Email notification handling
- **Background Processor** (`convex/processor.ts`): Scheduled task processing
- **Database Schema** (`convex/schema.ts`): Data model definitions

### Services (`src/lib/`)
- **GitHub Service** (`github.ts`): GitHub API integration and authentication
- **Email Service** (`email.ts`): Email template and delivery management

### Types (`src/types/`)
- **Core Types** (`index.ts`): Main application type definitions
- **Validators** (`validators.ts`): Input validation schemas and functions

### Tests (`tests/`)
- **Convex Tests** (`tests/convex/`): Backend function testing
- **Utility Tests** (`tests/utils/`): Helper function testing (future)

## Development Workflow

1. **Backend Development**: Work in `convex/` directory for database functions
2. **Service Development**: Work in `src/lib/` for external integrations
3. **Type Definitions**: Update `src/types/` for new data structures
4. **Testing**: Add tests in `tests/` directory matching the source structure
5. **Specifications**: Update feature specs in `.kiro/specs/`

## Testing

- Run all tests: `npm test`
- Run specific test file: `npm test -- tests/convex/rules.test.ts`
- Type checking: `npm run typecheck`

## Key Features Implemented

- ✅ **Rule Configuration System**: Complete CRUD operations for stale detection rules
- ✅ **Stale Issue Identification**: Multi-rule evaluation engine with analytics
- ✅ **Comprehensive Testing**: 28 passing tests covering validation and logic
- ✅ **Type Safety**: Full TypeScript support with proper type definitions
- ✅ **Organized Structure**: Clean separation of concerns and logical file organization