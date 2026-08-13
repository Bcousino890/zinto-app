# ERP read API

## Scope

This block exposes read-only ERP data for partner integrations. Tenant identity
comes from the API key; clients never send `company_id`.

Implemented resources:

- `GET /api/v1/erp/products`
- `GET /api/v1/erp/inventory/warehouses`
- `GET /api/v1/erp/inventory/stock-levels`
- `GET /api/v1/erp/suppliers`
- `GET /api/v1/erp/sales-orders`
- `GET /api/v1/erp/purchase-orders`
- `GET /api/v1/erp/invoices`

Every endpoint is cursor-paginated and requires `erp:read`. Inventory endpoints
also require `inventory:read`. There are no ERP write routes in this block.

Clients are intentionally not duplicated as an ERP table: the verified schema
uses the existing tenant-safe contacts resource, available through
`GET /api/v1/contacts` with `contacts:read`.

## Schema evidence and limits

The projections are based on the local backup migrations `150`, `151`, `153`,
`154`, `155`, `156`, and `177`. The API does not claim that those migrations are
applied to production; deployment must verify them against staging first.

Product variants, price tiers, stock movements/transfers, delivery notes, goods
receipts, invoice line items/payments, and accounting tables are deliberately
not exposed by this minimum contract yet. They need their own endpoint shapes
and relational tests before being added. Flows are outside this block.

## Verification

The local suite passes with `477` tests, typecheck, build, and diff checks. VPS,
production, and database migrations were not touched.
