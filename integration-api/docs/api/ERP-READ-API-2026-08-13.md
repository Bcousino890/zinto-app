# Zinto ERP Read API

## Estado y alcance

Este modulo expone un subconjunto de datos ERP en modo **solo lectura**. Las
rutas que se documentan aqui son las que estan conectadas por el runtime de la
API de integracion.

- No crea, edita, confirma, cancela ni elimina datos ERP.
- La empresa se obtiene exclusivamente de la API key.
- No se acepta `company_id` del cliente.

Base URL:

```text
https://crm.zinto.app/_integration-api
```

Autenticacion:

```http
Authorization: Bearer <ZINTO_API_KEY>
```

La API key debe tener el scope especifico de cada recurso. No existe un scope
generico `erp:read` para sustituirlos.

## Rutas conectadas

### Productos

Scope: `erp.products:read`

- `GET /api/v1/erp/products`
- `GET /api/v1/erp/products/{id}`

La lista acepta `limit` (1-200), `cursor`, `updated_since` y `status` (`active`,
`inactive`, `draft` o `archived`). Los productos incluyen identificadores,
nombre, descripcion, tipo, precios, moneda, unidad, codigo de barras, estado,
tags, fiscalidad, peso y timestamps.

### Niveles de stock

Scope: `erp.inventory:read`

- `GET /api/v1/erp/stock-levels`

La lista acepta `limit` (1-200), `cursor`, `product_id` y `warehouse_id`.
Devuelve cantidades, reservas, puntos de reposicion y referencias de producto,
variante y almacen cuando estan disponibles.

### Pedidos de venta

Scope: `erp.sales-orders:read`

- `GET /api/v1/erp/sales-orders`
- `GET /api/v1/erp/sales-orders/{id}`

La lista acepta `limit` (1-200), `cursor`, `updated_since` y `status`:
`draft`, `quotation`, `confirmed`, `processing`, `shipped`, `delivered`,
`cancelled` o `returned`.

Los pedidos devuelven cabecera y totales, incluyendo numero, contacto, deal,
estado, importes, moneda, usuario asignado, vigencia, origen, Flow, canal y
timestamps.

### Facturas

Scope: `erp.invoices:read`

- `GET /api/v1/erp/invoices`
- `GET /api/v1/erp/invoices/{id}`

La lista acepta `limit` (1-200), `cursor`, `updated_since`, `status` (`draft`,
`sent`, `partially_paid`, `paid`, `overdue`, `cancelled` o `void`) y `type`
(`sales_invoice`, `purchase_invoice`, `credit_note` o `debit_note`).

Las facturas devuelven cabecera, referencias, tipo, estado, fechas, importes,
pagos, saldo pendiente, moneda y timestamps.

## Respuesta paginada

Las listas usan este formato:

```json
{
  "data": [],
  "meta": {
    "request_id": "req_...",
    "next_cursor": null,
    "has_more": false
  }
}
```

Cuando `has_more` es `true`, repite exactamente la misma ruta y envia
`meta.next_cursor` como `cursor`. El cursor es opaco: no lo interpretes ni lo
construyas.

Los IDs de otra empresa no se revelan. Un recurso individual que no pertenece
a la empresa de la API key responde `404`.

## Rutas no conectadas

No deben implementarse contra este contrato las siguientes rutas, porque no
estan registradas actualmente:

- `GET /api/v1/erp/inventory/warehouses`
- `GET /api/v1/erp/suppliers`
- `GET /api/v1/erp/purchase-orders`
- Rutas individuales de stock, almacenes, proveedores o pedidos de compra.

## Pendientes conocidos

El siguiente alcance no esta publicado en el runtime actual:

- Escritura de productos, stock, pedidos o facturas.
- Variantes y niveles de precio como recursos independientes.
- Movimientos de stock, transferencias, entradas y salidas de almacen.
- Almacenes y proveedores como endpoints independientes.
- Pedidos de compra.
- Lineas detalladas de facturas, pagos, contabilidad y documentos PDF.

Esos recursos requieren validar el esquema de produccion, definir sus scopes y
crear pruebas de aislamiento antes de publicarse.
