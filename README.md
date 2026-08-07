# Zinto App

Aplicación ERP (Enterprise Resource Planning) completa para la gestión integral de operaciones empresariales.

## 📋 Descripción

Zinto es una plataforma web moderna diseñada para centralizar la gestión de recursos empresariales, incluyendo:
- Gestión de usuarios y permisos
- Dashboard de análisis en tiempo real
- Módulos de negocio configurables
- API REST escalable

## 🚀 Stack Tecnológico

### Backend
- **Node.js** + **Express.js**
- **TypeScript** para seguridad de tipos
- **PostgreSQL** para persistencia de datos
- **Prisma ORM** para gestión de base de datos

### Frontend
- **React 18** con TypeScript
- **Vite** para bundling rápido
- **Tailwind CSS** para estilos
- **React Router** para navegación

### DevOps
- **Docker** y **Docker Compose** para containerización
- **GitHub Actions** para CI/CD

## 📁 Estructura del Proyecto

```
zinto-app/
├── apps/
│   ├── backend/          # API Express + TypeScript
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── frontend/         # React + Vite
│       ├── src/
│       ├── public/
│       └── package.json
├── packages/
│   └── shared/           # Tipos y utilidades compartidas
├── docker-compose.yml    # Orquestación de servicios
├── .github/
│   └── workflows/        # CI/CD pipelines
└── docs/                 # Documentación del proyecto
```

## 🛠️ Requisitos Previos

- Node.js 18+
- npm o yarn
- Docker (opcional, para desarrollo con contenedores)
- PostgreSQL 14+ (si se ejecuta localmente sin Docker)

## 📦 Instalación

### Opción 1: Con Docker (Recomendado)

```bash
docker-compose up -d
```

### Opción 2: Instalación Local

#### Backend
```bash
cd apps/backend
npm install
npm run dev
```

#### Frontend
```bash
cd apps/frontend
npm install
npm run dev
```

El servidor backend estará disponible en `http://localhost:3000`
El frontend estará disponible en `http://localhost:5173`

## 🔧 Scripts Disponibles

### Backend
```bash
npm run dev       # Desarrollo con hot-reload
npm run build     # Compilar a producción
npm run start     # Iniciar servidor compilado
npm run test      # Ejecutar pruebas
npm run lint      # Verificar código
```

### Frontend
```bash
npm run dev       # Desarrollo con Vite
npm run build     # Build para producción
npm run preview   # Vista previa del build
npm run test      # Ejecutar pruebas
```

## 🗄️ Base de Datos

### Setup Inicial
```bash
cd apps/backend
npx prisma migrate dev --name init
npx prisma db seed
```

### Ver datos con Prisma Studio
```bash
npx prisma studio
```

## 🧪 Testing

```bash
# Backend tests
cd apps/backend
npm test

# Frontend tests
cd apps/frontend
npm test

# Coverage
npm run test:coverage
```

## 📚 Documentación

- [API Docs](./docs/API.md) - Documentación de endpoints
- [Architecture](./docs/ARCHITECTURE.md) - Arquitectura del sistema
- [Contributing](./CONTRIBUTING.md) - Guía de contribución
- [Database Schema](./docs/DATABASE.md) - Esquema de BD

## 🔐 Variables de Entorno

Copia `.env.example` a `.env` y configura:

**Backend (.env)**
```
DATABASE_URL=postgresql://user:password@localhost:5432/zinto
JWT_SECRET=your-secret-key
NODE_ENV=development
```

**Frontend (.env)**
```
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=Zinto
```

## 🚀 Deployment

### A Producción
```bash
npm run build
npm run start
```

### Con Docker
```bash
docker build -t zinto-app .
docker run -p 3000:3000 zinto-app
```

## 📄 Licencia

Este proyecto está bajo licencia MIT. Ver `LICENSE` para más detalles.

## 🤝 Contribución

Las contribuciones son bienvenidas. Por favor, lee [CONTRIBUTING.md](./CONTRIBUTING.md) para detalles sobre nuestro código de conducta y proceso de contribución.

## 📧 Contacto

Para preguntas o sugerencias, contacta al equipo de desarrollo.

---

**Última actualización:** 2026-08-07
