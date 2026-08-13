-- Give each worker claim an opaque owner token so an expired worker cannot
-- overwrite the result of a later worker that reclaimed the same delivery.
ALTER TABLE integration_api_webhook_deliveries
  ADD COLUMN IF NOT EXISTS lease_token TEXT;
