-- Defense-in-depth CHECK constraints for purchasing / finance documents (L11)
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_paid_range" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_returned_range" CHECK ("returned_amount" >= 0 AND "returned_amount" <= "total_amount");
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_returned_range" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity");
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_refunded_range" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total_amount");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_received_range" CHECK ("received_quantity" >= 0 AND "received_quantity" <= "quantity");
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0 AND "allocated" >= 0 AND "allocated" <= "amount");
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0);
