-- Indices de rendimiento para los listados por cursor de la Integration API.
--
-- No forman parte de 001_integration_api.sql a proposito: esa migracion es
-- aditiva sobre objetos propios (tablas/triggers integration_api_*) y corre en
-- una unica transaccion. Estos indices, en cambio, se crean sobre tablas
-- existentes y de alto trafico (contacts, conversations, deals) y por eso usan
-- CONCURRENTLY para no bloquear escrituras mientras se construyen.
--
-- IMPORTANTE: CREATE INDEX CONCURRENTLY no puede ejecutarse dentro de un
-- bloque de transaccion. Este archivo NO lleva BEGIN/COMMIT y debe aplicarse
-- tal cual, sentencia por sentencia (psql en modo autocommit, el
-- comportamiento por defecto sin -1/--single-transaction):
--
--   psql -v ON_ERROR_STOP=1 -f 002_performance_indexes.sql
--
-- Evidencia y justificacion completas: docs/api/STAGING-REPORT-2026-08-13.md
-- seccion 6. Re-verificado en un staging aislado nuevo (restaurado del mismo
-- backup, destruido despues) el 13 de agosto de 2026: los 3 indices se crean
-- en <20 ms cada uno sobre el volumen actual de produccion (contacts=1161,
-- conversations=917, deals=513) y cambian el plan de listContacts/
-- listConversations/listDeals de Seq Scan+Sort a Index Scan, con una
-- reduccion de buffers leidos de 42->7, 28->5 y 18->9 respectivamente para la
-- empresa con mas volumen del dataset (company_id=3, 712 contactos).
--
-- Riesgo: bajo. Son aditivos (no tocan datos ni columnas existentes), no
-- bloquean escrituras por CONCURRENTLY, y su tamano en el dataset actual es
-- de 40-64 kB cada uno. Requisito de CONCURRENTLY: no puede correr dentro de
-- una transaccion explicita ni junto con otra migracion sobre la misma tabla
-- en paralelo.
--
-- Si CREATE INDEX CONCURRENTLY falla a mitad de camino (p.ej. por una
-- desconexion), puede dejar un indice invalido. Verificar con:
--   SELECT indexrelid::regclass, indisvalid FROM pg_index
--    WHERE indexrelid::regclass::text LIKE 'idx_%_company_created%';
-- y si indisvalid = false, hacer DROP INDEX CONCURRENTLY <nombre> y reintentar.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company_created_id_active
  ON contacts (company_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_company_created_id
  ON conversations (company_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_company_created_id
  ON deals (company_id, created_at DESC, id DESC);
