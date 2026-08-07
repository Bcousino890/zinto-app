# Zinto ERP - Database Schema

## Overview

Zinto utiliza PostgreSQL como base de datos relacional. El esquema está definido en `prisma/schema.prisma`.

## Tables

### Users

Almacena información de usuarios del sistema.

```sql
CREATE TABLE "User" (
  id          String      PRIMARY KEY @default(cuid())
  email       String      UNIQUE NOT NULL
  password    String      NOT NULL (hashed with bcryptjs)
  firstName   String?
  lastName    String?
  role        UserRole    @default(USER)
  isActive    Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  Indexes:
  - email (for login queries)
  - role (for authorization queries)
}
```

**Roles:**
- `ADMIN` - Acceso total
- `MANAGER` - Puede crear/editar departamentos y proyectos
- `USER` - Acceso de lectura

---

### Departments

Almacena información de departamentos.

```sql
CREATE TABLE "Department" (
  id          String      PRIMARY KEY @default(cuid())
  name        String      UNIQUE NOT NULL
  code        String      UNIQUE NOT NULL
  description String?
  budget      Float       @default(0)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  Indexes:
  - code (for lookup queries)
}
```

---

### Projects

Almacena información de proyectos.

```sql
CREATE TABLE "Project" (
  id          String          PRIMARY KEY @default(cuid())
  name        String          NOT NULL
  description String?
  status      ProjectStatus   @default(ACTIVE)
  startDate   DateTime        NOT NULL
  endDate     DateTime?
  budget      Float?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  Indexes:
  - status (for filtering)
  - startDate (for ordering)
}
```

**Project Status:**
- `ACTIVE` - Proyecto en curso
- `PAUSED` - Proyecto pausado
- `COMPLETED` - Proyecto finalizado
- `CANCELLED` - Proyecto cancelado

---

## Relationships

Actualmente, las tablas no tienen relaciones explícitas. Las futuras versiones pueden incluir:

### Propuestas para v2.0:

```prisma
model Department {
  // ... existing fields
  users       User[]      @relation("DepartmentUsers")
  projects    Project[]
}

model Project {
  // ... existing fields
  departmentId String?
  department   Department?   @relation(fields: [departmentId], references: [id])
  members      User[]        @relation("ProjectMembers")
}

model User {
  // ... existing fields
  departmentId String?
  department   Department?   @relation("DepartmentUsers", fields: [departmentId], references: [id])
  projects     Project[]     @relation("ProjectMembers")
}
```

---

## Setup & Migrations

### Initial Setup

```bash
# Set DATABASE_URL in .env
export DATABASE_URL="postgresql://user:password@localhost:5432/zinto_db"

# Run migrations
npx prisma migrate dev --name init

# Generate Prisma Client
npx prisma generate

# Seed database (optional)
npx prisma db seed
```

### Creating Migrations

```bash
# After modifying schema.prisma
npx prisma migrate dev --name descriptive_name
```

### View Data

```bash
# Open Prisma Studio (web UI)
npx prisma studio
```

---

## Indexing Strategy

Current indexes:
- `User.email` - Queries de login
- `User.role` - Filtros de autorización
- `Department.code` - Búsquedas por código
- `Project.status` - Filtros de estado
- `Project.startDate` - Ordenamiento

**Propuestas para optimización:**
- Índice compuesto en `(startDate, status)` para queries frecuentes
- Índice en `updatedAt` para auditoría

---

## Backup & Recovery

### Backup
```bash
pg_dump -U zinto zinto_db > backup.sql
```

### Restore
```bash
psql -U zinto zinto_db < backup.sql
```

### Docker Backup
```bash
docker exec zinto_postgres pg_dump -U zinto zinto_db > backup.sql
```

---

## Data Integrity

### Constraints

1. **Unique Constraints:**
   - `User.email` - Evita duplicados
   - `Department.name` - Evita departamentos duplicados
   - `Department.code` - Códigos únicos

2. **Default Values:**
   - `User.role` = USER
   - `User.isActive` = true
   - `Department.budget` = 0
   - `Project.status` = ACTIVE

3. **Required Fields:**
   - `User.email`, `password`
   - `Department.name`, `code`
   - `Project.name`, `startDate`

---

## Performance Considerations

### Queries Comunes

```sql
-- Login (por email)
SELECT * FROM "User" WHERE email = $1;
-- ✓ Índice existe

-- Listar usuarios por rol
SELECT * FROM "User" WHERE role = $1;
-- ✓ Índice existe

-- Proyectos activos ordenados
SELECT * FROM "Project" 
WHERE status = 'ACTIVE' 
ORDER BY startDate DESC;
-- ⚠️ Considerar índice compuesto

-- Departamentos (sin filtros)
SELECT * FROM "Department" ORDER BY name;
-- ✓ Tabla pequeña, sin índice necesario
```

### Connection Pooling

En producción, usar pooler de conexiones (PgBouncer, pgpool):

```
DATABASE_URL="postgresql://user:password@pooler-host:6432/zinto_db?schema=public"
```

---

## Security Best Practices

1. ✓ Passwords hasheadas con bcryptjs
2. ✓ SQL Injection protection (Prisma ORM)
3. ⚠️ Auditar cambios (agregar tabla de auditoría)
4. ⚠️ Rate limiting en login
5. ⚠️ Encryption de datos sensibles

---

## Future Enhancements

- [ ] Tabla de auditoría para cambios
- [ ] Soft deletes (marca como eliminado)
- [ ] Versionado de datos
- [ ] Relaciones entre modelos
- [ ] Transacciones para operaciones complejas
- [ ] Replicación para high availability
