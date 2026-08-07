# Guía de Contribución

Gracias por tu interés en contribuir a Zinto App. Este documento proporciona directrices y procedimientos para contribuir al proyecto.

## 📋 Código de Conducta

Todos los contribuyentes deben seguir nuestro Código de Conducta:
- Sé respetuoso con otros contribuyentes
- Proporciona crítica constructiva
- Enfócate en lo mejor para la comunidad
- Muestra empatía con otros usuarios

## 🔄 Proceso de Contribución

### 1. Fork y Clone
```bash
git clone https://github.com/tu-usuario/zinto-app.git
cd zinto-app
git checkout -b feature/tu-feature-name
```

### 2. Configura el Entorno
```bash
npm install
cp .env.example .env
# Configura variables de entorno necesarias
docker-compose up -d  # Si usas Docker
```

### 3. Haz tus Cambios
- Crea commits pequeños y descriptivos
- Usa mensajes de commit claros
- Sigue las convenciones de código del proyecto

### 4. Pruebas
```bash
npm test           # Ejecuta todas las pruebas
npm run lint       # Verifica el código
npm run type-check # Verifica tipos TypeScript
```

### 5. Push y Pull Request
```bash
git push origin feature/tu-feature-name
```

Luego abre un Pull Request en GitHub con:
- Descripción clara de cambios
- Referencias a issues relacionados (#123)
- Screenshots si es UI

## 🎯 Estándares de Código

### TypeScript
- Utiliza tipos explícitos
- Evita `any`
- Sigue strict mode

### Nombres
- Variables: `camelCase`
- Funciones: `camelCase`
- Clases: `PascalCase`
- Constantes: `UPPER_SNAKE_CASE`

### Formato
```bash
npm run format  # Prettier
npm run lint:fix  # ESLint auto-fix
```

## 📝 Commits

Formato de commit messages:
```
<tipo>: <descripción corta>

<descripción detallada si es necesario>

Fixes #123
```

Tipos:
- `feat:` Nueva funcionalidad
- `fix:` Corrección de bug
- `docs:` Cambios en documentación
- `style:` Formato, semicolons, etc
- `refactor:` Refactorización sin cambios de funcionalidad
- `perf:` Mejoras de performance
- `test:` Agregar/actualizar tests
- `chore:` Dependencias, build, etc

## 🧪 Testing

- Escribe tests para nuevas funcionalidades
- Mantén cobertura arriba del 80%
- Tests deben ser determinísticos

```bash
npm test -- --coverage
```

## 📚 Documentación

- Actualiza README.md si cambias funcionalidad pública
- Documenta APIs y funciones públicas
- Añade ejemplos cuando sea útil
- Mantén docs/ARCHITECTURE.md actualizado

## 🐛 Reportar Bugs

1. Verifica que el bug no existe ya
2. Crea un issue con:
   - Descripción clara
   - Pasos para reproducir
   - Comportamiento esperado vs actual
   - Versión de Node.js/navegador

## 🎨 Nuevas Características

1. Abre un issue primero para discutir
2. Proporciona contexto y use cases
3. Espera feedback antes de codear
4. Implementa siguiendo los estándares

## 🔍 Revisión de PRs

- Los PRs requieren al menos 1 revisión
- Todos los tests deben pasar
- No hay conflictos de merge
- Coverage no debe bajar

## 📦 Releases

Versionamiento semántico (MAJOR.MINOR.PATCH):
- MAJOR: cambios incompatibles
- MINOR: nuevas features compatibles
- PATCH: bug fixes

## ❓ Preguntas?

- Abre un issue para discusiones
- Consulta la documentación en `/docs`
- Comunícate con el equipo

---

¡Gracias por contribuir! 🎉
