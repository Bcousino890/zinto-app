# Zinto ERP - API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
All endpoints (except `/auth/register` and `/auth/login`) require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Response Format

### Success Response
```json
{
  "id": "...",
  "name": "...",
  "createdAt": "2026-08-07T..."
}
```

### Error Response
```json
{
  "error": "Error message",
  "statusCode": 400
}
```

---

## Authentication Endpoints

### Register User
**POST** `/auth/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response (201):**
```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `409` - User already exists

---

### Login
**POST** `/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `401` - Invalid credentials

---

## User Endpoints

### Get All Users
**GET** `/users`

**Authentication:** Required

**Response (200):**
```json
[
  {
    "id": "...",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "USER",
    "isActive": true,
    "createdAt": "2026-08-07T..."
  }
]
```

---

### Get User by ID
**GET** `/users/:id`

**Authentication:** Required

**Response (200):**
```json
{
  "id": "...",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "USER",
  "isActive": true,
  "createdAt": "2026-08-07T..."
}
```

---

### Update User
**PATCH** `/users/:id`

**Authentication:** Required (ADMIN only)

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "isActive": false
}
```

**Response (200):**
```json
{
  "id": "...",
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "role": "USER",
  "isActive": false
}
```

---

## Department Endpoints

### Get All Departments
**GET** `/departments`

**Authentication:** Required

**Response (200):**
```json
[
  {
    "id": "...",
    "name": "Engineering",
    "code": "ENG",
    "description": "Engineering department",
    "budget": 50000,
    "createdAt": "2026-08-07T..."
  }
]
```

---

### Create Department
**POST** `/departments`

**Authentication:** Required (MANAGER, ADMIN)

**Request Body:**
```json
{
  "name": "Engineering",
  "code": "ENG",
  "description": "Engineering department",
  "budget": 50000
}
```

**Response (201):**
```json
{
  "id": "...",
  "name": "Engineering",
  "code": "ENG",
  "description": "Engineering department",
  "budget": 50000,
  "createdAt": "2026-08-07T..."
}
```

---

### Get Department by ID
**GET** `/departments/:id`

**Authentication:** Required

**Response (200):**
```json
{
  "id": "...",
  "name": "Engineering",
  "code": "ENG",
  "description": "Engineering department",
  "budget": 50000,
  "createdAt": "2026-08-07T..."
}
```

---

### Update Department
**PATCH** `/departments/:id`

**Authentication:** Required (MANAGER, ADMIN)

**Request Body:**
```json
{
  "name": "Engineering",
  "budget": 75000
}
```

**Response (200):**
```json
{
  "id": "...",
  "name": "Engineering",
  "code": "ENG",
  "description": "Engineering department",
  "budget": 75000,
  "createdAt": "2026-08-07T..."
}
```

---

### Delete Department
**DELETE** `/departments/:id`

**Authentication:** Required (ADMIN only)

**Response (204):** No content

---

## Project Endpoints

### Get All Projects
**GET** `/projects`

**Authentication:** Required

**Response (200):**
```json
[
  {
    "id": "...",
    "name": "Mobile App",
    "description": "iOS and Android app",
    "status": "ACTIVE",
    "startDate": "2026-01-01T...",
    "endDate": "2026-12-31T...",
    "budget": 100000,
    "createdAt": "2026-08-07T..."
  }
]
```

---

### Create Project
**POST** `/projects`

**Authentication:** Required (MANAGER, ADMIN)

**Request Body:**
```json
{
  "name": "Mobile App",
  "description": "iOS and Android app",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31",
  "status": "ACTIVE",
  "budget": 100000
}
```

**Response (201):**
```json
{
  "id": "...",
  "name": "Mobile App",
  "description": "iOS and Android app",
  "status": "ACTIVE",
  "startDate": "2026-01-01T...",
  "endDate": "2026-12-31T...",
  "budget": 100000,
  "createdAt": "2026-08-07T..."
}
```

---

### Get Project by ID
**GET** `/projects/:id`

**Authentication:** Required

**Response (200):**
```json
{
  "id": "...",
  "name": "Mobile App",
  "description": "iOS and Android app",
  "status": "ACTIVE",
  "startDate": "2026-01-01T...",
  "endDate": "2026-12-31T...",
  "budget": 100000,
  "createdAt": "2026-08-07T..."
}
```

---

### Update Project
**PATCH** `/projects/:id`

**Authentication:** Required (MANAGER, ADMIN)

**Request Body:**
```json
{
  "status": "COMPLETED",
  "budget": 120000
}
```

**Response (200):**
```json
{
  "id": "...",
  "name": "Mobile App",
  "description": "iOS and Android app",
  "status": "COMPLETED",
  "startDate": "2026-01-01T...",
  "endDate": "2026-12-31T...",
  "budget": 120000,
  "createdAt": "2026-08-07T..."
}
```

---

### Delete Project
**DELETE** `/projects/:id`

**Authentication:** Required (ADMIN only)

**Response (204):** No content

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request successful |
| 201 | Created - Resource created |
| 204 | No Content - Successful delete |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing/invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error |

---

## Rate Limiting

Currently not implemented. Consider adding for production.

---

## Changelog

### v1.0.0 (2026-08-07)
- Initial API release
- Authentication & authorization
- CRUD operations for Users, Departments, Projects
