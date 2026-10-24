ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_quantities" CHECK ("total_quantity" >= 0 AND "received_quantity" >= 0 AND "shortage_quantity" >= 0 AND "shortage_value" >= 0 AND "received_quantity" + "shortage_quantity" <= "total_quantity" + 0.001);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_received_range" CHECK ("received_quantity" IS NULL OR ("received_quantity" >= 0 AND "received_quantity" <= "quantity"));
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_counters" CHECK ("total_lines" >= 0 AND "counted_lines" >= 0 AND "counted_lines" <= "total_lines" AND "increase_quantity" >= 0 AND "decrease_quantity" >= 0 AND "increase_value" >= 0 AND "decrease_value" >= 0);
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_counted_nonneg" CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0);
