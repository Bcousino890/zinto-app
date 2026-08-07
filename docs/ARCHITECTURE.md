# Zinto ERP - Architecture

## System Overview

Zinto es una aplicación ERP moderna construida con una arquitectura de dos capas:

```
┌─────────────────────────────────────────┐
│           Frontend (React)               │
│        User Interface & Routes           │
│                                         │
│  - Dashboard, Users, Departments       │
│  - Projects Management                 │
│  - Authentication & Authorization      │
└──────────────┬──────────────────────────┘
               │ HTTP/REST API
┌──────────────▼──────────────────────────┐
│         Backend (Node.js/Express)       │
│                                         │
│  - API Endpoints                       │
│  - Business Logic                      │
│  - Authentication (JWT)                │
│  - Authorization (Role-based)          │
└──────────────┬──────────────────────────┘
               │ SQL
┌──────────────▼──────────────────────────┐
│        PostgreSQL Database              │
│                                         │
│  - Users, Departments, Projects        │
│  - Roles & Permissions                 │
└─────────────────────────────────────────┘
```

## Backend Architecture

### Directory Structure
```
apps/backend/
├── src/
│   ├── index.ts              # Application entry point
│   ├── types/               # TypeScript type definitions
│   ├── middleware/          # Express middleware
│   │   ├── auth.ts         # JWT authentication
│   │   └── error.handler.ts # Error handling
│   ├── routes/             # API route handlers
│   │   ├── auth.routes.ts
│   │   ├── users.routes.ts
│   │   ├── departments.routes.ts
│   │   └── projects.routes.ts
│   ├── db/                 # Database utilities
│   └── services/           # Business logic (future)
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/                  # Unit & integration tests
└── package.json
```

### Key Technologies
- **Express.js**: Web framework
- **TypeScript**: Type safety
- **Prisma ORM**: Database access
- **JWT**: Authentication
- **Zod**: Input validation
- **PostgreSQL**: Database

### API Routes

#### Authentication (`/api/auth`)
- `POST /register` - Create new user
- `POST /login` - User login

#### Users (`/api/users`)
- `GET /` - List all users
- `GET /:id` - Get user by ID
- `PATCH /:id` - Update user (admin only)

#### Departments (`/api/departments`)
- `GET /` - List departments
- `POST /` - Create department
- `GET /:id` - Get department
- `PATCH /:id` - Update department
- `DELETE /:id` - Delete department

#### Projects (`/api/projects`)
- `GET /` - List projects
- `POST /` - Create project
- `GET /:id` - Get project
- `PATCH /:id` - Update project
- `DELETE /:id` - Delete project

## Frontend Architecture

### Directory Structure
```
apps/frontend/
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main app component
│   ├── index.css           # Global styles
│   ├── components/         # Reusable components
│   │   └── Layout.tsx
│   ├── pages/              # Page components
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Users.tsx
│   │   ├── Departments.tsx
│   │   └── Projects.tsx
│   ├── store/              # State management (Zustand)
│   │   └── auth.ts
│   └── lib/                # Utilities
│       └── api.ts          # API client
├── public/                 # Static files
└── package.json
```

### Key Technologies
- **React 18**: UI framework
- **TypeScript**: Type safety
- **React Router**: Routing
- **Zustand**: State management
- **Axios**: HTTP client
- **Tailwind CSS**: Styling
- **Vite**: Build tool

### Component Structure

```
App
├── Auth Pages (Login/Register)
└── Protected Routes
    └── Layout
        ├── Sidebar
        ├── Header
        └── Main Content
            ├── Dashboard
            ├── Users
            ├── Departments
            └── Projects
```

## Database Schema

### Users Table
```sql
- id (PK)
- email (UNIQUE)
- password (hashed)
- firstName
- lastName
- role (ADMIN, MANAGER, USER)
- isActive
- createdAt
- updatedAt
```

### Departments Table
```sql
- id (PK)
- name (UNIQUE)
- code (UNIQUE)
- description
- budget
- createdAt
- updatedAt
```

### Projects Table
```sql
- id (PK)
- name
- description
- status (ACTIVE, PAUSED, COMPLETED, CANCELLED)
- startDate
- endDate
- budget
- createdAt
- updatedAt
```

## Authentication & Authorization

### JWT Flow
1. User registers or logs in
2. Backend validates credentials
3. Backend issues JWT token
4. Frontend stores token in localStorage
5. Frontend sends token in Authorization header for API requests
6. Backend verifies token before processing requests

### Roles & Permissions
- **ADMIN**: Full access to all operations
- **MANAGER**: Can create/edit departments and projects
- **USER**: Read-only access

## Data Flow

### Example: Create Department
```
1. User fills form in Frontend
2. Frontend sends POST /api/departments with token
3. Backend middleware verifies JWT
4. Backend validates data with Zod
5. Backend calls Prisma to insert into DB
6. Backend returns created department
7. Frontend updates state and refreshes view
```

## Deployment

### Development
```bash
npm run dev  # Both backend and frontend
```

### Docker
```bash
docker-compose up  # Full stack with database
```

### Production
```bash
npm run build
npm start
```

## Security Considerations

1. **Authentication**: JWT tokens with expiration
2. **Authorization**: Role-based access control
3. **Input Validation**: Zod schema validation
4. **Password**: Bcrypt hashing
5. **CORS**: Configured for frontend origin
6. **Environment Variables**: Sensitive data in .env

## Scalability

Future improvements:
- Database indexing strategies
- Caching layer (Redis)
- API rate limiting
- Logging & monitoring
- Message queue for async tasks
- Microservices architecture
