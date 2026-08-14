export const webhookEventTypes = [
  "contact.created", "contact.updated", "contact.deleted",
  "conversation.created", "conversation.updated",
  "message.created", "message.status.updated",
  "note.created", "note.updated", "note.deleted",
  "tag.attached", "tag.detached",
  "deal.created", "deal.updated", "deal.stage.changed", "deal.deleted",
  "pipeline.created", "pipeline.updated", "pipeline.deleted",
  "pipeline.stage.created", "pipeline.stage.updated", "pipeline.stage.deleted",
  "task.created", "task.updated", "task.completed", "task.deleted",
  "channel.connection.updated",
  "erp.product.created", "erp.product.updated", "erp.product.deleted",
  "erp.stock_level.created", "erp.stock_level.updated", "erp.stock_level.deleted",
  "erp.stock_movement.created", "erp.stock_movement.updated", "erp.stock_movement.deleted",
  "erp.stock_transfer.created", "erp.stock_transfer.updated", "erp.stock_transfer.deleted",
  "erp.sales_order.created", "erp.sales_order.updated", "erp.sales_order.deleted",
  "erp.supplier.created", "erp.supplier.updated", "erp.supplier.deleted",
  "erp.purchase_order.created", "erp.purchase_order.updated", "erp.purchase_order.deleted",
  "erp.invoice.created", "erp.invoice.updated", "erp.invoice.deleted",
  "erp.invoice_payment.created", "erp.invoice_payment.updated", "erp.invoice_payment.deleted",
  "flow.created", "flow.updated", "flow.deleted",
  "flow.execution.started", "flow.execution.updated", "flow.execution.completed", "flow.execution.failed"
] as const;

export type WebhookEventType = typeof webhookEventTypes[number];
